// ============================================================
// FILE: src/app/api/cca/sync/route.ts
// PURPOSE: Sync USDC transfers to CCA contract from Base chain
// Loops through 10-block chunks (Alchemy free tier limit)
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createPublicClient, http, parseAbiItem, formatUnits } from "viem";
import { base } from "viem/chains";

const CCA_CONTRACT = "0x7e867b47a94df05188c08575e8B9a52F3F69c469";
const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_DECIMALS = 6;
const CHUNK_SIZE = 2000;      // Blocks per getLogs call (pay-as-you-go Alchemy)
const CHUNKS_PER_CALL = 100;  // Process 200k blocks per API call
const SYNC_STATE_ID = "base_usdc_to_cca";
// Contract was deployed at block ~41610525
const GENESIS_BLOCK = BigInt(41610000);

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

function getViemClient() {
  const rpcUrl = process.env.BASE_RPC_URL;
  if (!rpcUrl) throw new Error("Missing BASE_RPC_URL");
  return createPublicClient({ chain: base, transport: http(rpcUrl) });
}

async function getLastProcessedBlock(sb: any): Promise<bigint> {
  const { data, error } = await sb
    .from("cca_sync_state")
    .select("last_processed_block")
    .eq("id", SYNC_STATE_ID)
    .single();
  if (error || !data) return BigInt(0);
  return BigInt(Number(data.last_processed_block));
}

async function saveLastProcessedBlock(sb: any, block: bigint) {
  const { error } = await sb.from("cca_sync_state").upsert(
    { id: SYNC_STATE_ID, last_processed_block: Number(block), updated_at: new Date().toISOString() },
    { onConflict: "id" }
  );
  if (error) console.error("SAVE BLOCK ERROR:", JSON.stringify(error));
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get("secret");
    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase: any = getSupabaseAdmin();
    const viemClient = getViemClient();

    // Allow reset via ?reset=BLOCK_NUMBER
    const resetBlock = searchParams.get("reset");
    if (resetBlock) {
      const block = parseInt(resetBlock, 10);
      if (!isNaN(block)) {
        await saveLastProcessedBlock(supabase, BigInt(block));
        return NextResponse.json({ success: true, message: `Reset sync to block ${block}` });
      }
    }

    const lastProcessedBlock = await getLastProcessedBlock(supabase);
    const currentBlock = await viemClient.getBlockNumber();

    // Start from genesis block if no progress, otherwise resume
    let cursor = lastProcessedBlock === BigInt(0)
      ? GENESIS_BLOCK
      : lastProcessedBlock + BigInt(1);

    if (cursor > currentBlock) {
      return NextResponse.json({
        success: true, message: "Already up to date",
        currentBlock: Number(currentBlock),
        lastProcessedBlock: Number(lastProcessedBlock),
      });
    }

    const transferEvent = parseAbiItem(
      "event Transfer(address indexed from, address indexed to, uint256 value)"
    );

    // Loop through 10-block chunks with rate limit handling
    const newTransfers: any[] = [];
    let chunksProcessed = 0;
    let rateLimitHits = 0;

    while (cursor <= currentBlock && chunksProcessed < CHUNKS_PER_CALL) {
      const chunkEnd = cursor + BigInt(CHUNK_SIZE) > currentBlock
        ? currentBlock
        : cursor + BigInt(CHUNK_SIZE);

      let success = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const logs = await viemClient.getLogs({
            address: USDC_CONTRACT as `0x${string}`,
            event: transferEvent,
            args: { to: CCA_CONTRACT as `0x${string}` },
            fromBlock: cursor,
            toBlock: chunkEnd,
          });

          for (const log of logs) {
            const from = log.args.from as string;
            const rawValue = log.args.value as bigint;
            const usdcAmount = parseFloat(formatUnits(rawValue, USDC_DECIMALS));
            newTransfers.push({
              tx_hash: log.transactionHash,
              block_number: Number(log.blockNumber),
              from_address: from.toLowerCase(),
              to_address: CCA_CONTRACT.toLowerCase(),
              amount_usdc: usdcAmount,
              block_time: new Date().toISOString(), // approximate; updated below if block data available
            });
          }
          success = true;
          break;
        } catch (e: any) {
          if (e?.message?.includes("429") || e?.message?.includes("Too Many")) {
            rateLimitHits++;
            await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          } else {
            console.error(`Error fetching logs for blocks ${cursor}-${chunkEnd}:`, e?.message);
            break;
          }
        }
      }

      if (!success && rateLimitHits >= 3) {
        // Save progress and bail — caller can retry
        break;
      }

      cursor = chunkEnd + BigInt(1);
      chunksProcessed++;

      // Small delay every 10 chunks to stay under rate limits
      if (chunksProcessed % 10 === 0) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    const finalBlock = cursor - BigInt(1);

    // Insert new transfers
    if (newTransfers.length > 0) {
      const { error: insertError } = await supabase
        .from("cca_transfers")
        .upsert(newTransfers, { onConflict: "tx_hash" });
      if (insertError) throw new Error(`Failed to insert: ${insertError.message}`);
    }

    // Aggregate per-wallet stats
    const { data: allTransfers } = await supabase
      .from("cca_transfers").select("from_address, amount_usdc, block_time");

    const transfers = (allTransfers || []) as { from_address: string; amount_usdc: number; block_time: string }[];
    const walletMap = new Map<string, { total: number; count: number; lastBidTime: string }>();
    for (const t of transfers) {
      const existing = walletMap.get(t.from_address) || { total: 0, count: 0, lastBidTime: "" };
      existing.total += t.amount_usdc;
      existing.count += 1;
      if (t.block_time > existing.lastBidTime) existing.lastBidTime = t.block_time;
      walletMap.set(t.from_address, existing);
    }

    const walletRows = Array.from(walletMap.entries()).map(([address, data]) => ({
      address,
      total_usdc: data.total,
      bid_count: data.count,
      last_bid_time: data.lastBidTime || null,
    }));

    if (walletRows.length > 0) {
      for (let i = 0; i < walletRows.length; i += 500) {
        await supabase.from("cca_wallets").upsert(walletRows.slice(i, i + 500), { onConflict: "address" });
      }
    }

    // Compute global stats
    const allAmounts = transfers.map((t) => t.amount_usdc);
    const totalUsdc = allAmounts.reduce((sum, v) => sum + v, 0);
    const totalBids = allAmounts.length;
    const avgBid = totalBids > 0 ? totalUsdc / totalBids : 0;

    const sortedWallets = Array.from(walletMap.entries()).sort((a, b) => b[1].total - a[1].total);
    const top10Total = sortedWallets.slice(0, 10).reduce((sum, [, d]) => sum + d.total, 0);
    const top50Total = sortedWallets.slice(0, 50).reduce((sum, [, d]) => sum + d.total, 0);
    const bidsUnder50 = allAmounts.filter((v) => v < 50).length;
    const bidsUnder100 = allAmounts.filter((v) => v < 100).length;

    // Use actual Supabase column names
    await supabase.from("cca_stats_latest").upsert({
      id: SYNC_STATE_ID,
      total_usdc: totalUsdc,
      total_bids: totalBids,
      unique_wallets: walletMap.size,
      avg_bid: avgBid,
      median_bid: computeMedian(allAmounts),
      pct_bids_lt_50: totalBids > 0 ? (bidsUnder50 / totalBids) * 100 : 0,
      pct_bids_lt_100: totalBids > 0 ? (bidsUnder100 / totalBids) * 100 : 0,
      top10_share: totalUsdc > 0 ? (top10Total / totalUsdc) * 100 : 0,
      top50_share: totalUsdc > 0 ? (top50Total / totalUsdc) * 100 : 0,
      last_processed_block: Number(finalBlock),
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });

    // Save sync cursor
    await saveLastProcessedBlock(supabase, finalBlock);

    const blocksRemaining = Number(currentBlock) - Number(finalBlock);
    return NextResponse.json({
      success: true,
      blocksScanned: chunksProcessed * CHUNK_SIZE,
      blockRange: {
        from: Number(lastProcessedBlock === BigInt(0) ? GENESIS_BLOCK : lastProcessedBlock + BigInt(1)),
        to: Number(finalBlock),
      },
      newTransfers: newTransfers.length,
      totalTransfersInDb: totalBids,
      currentBlock: Number(currentBlock),
      caughtUp: finalBlock >= currentBlock,
      savedBlock: Number(finalBlock),
      blocksRemaining,
      estimatedCallsRemaining: Math.ceil(blocksRemaining / (CHUNKS_PER_CALL * CHUNK_SIZE)),
    });
  } catch (err: unknown) {
    console.error("Sync error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
