// ============================================================
// FILE: src/app/api/cca/sync/route.ts
//
// PURPOSE: Backend engine that:
//   1. Reads Base blockchain for USDC transfers to the CCA contract
//   2. Saves each transfer to Supabase
//   3. Updates per-wallet aggregates
//   4. Computes global stats (total, avg, median, etc.)
//
// HOW TO CALL IT:
//   GET http://localhost:3000/api/cca/sync?secret=YOUR_CRON_SECRET
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createPublicClient, http, parseAbiItem, formatUnits } from "viem";
import { base } from "viem/chains";

// ─── Configuration ───────────────────────────────────────────
const CCA_CONTRACT = "0x7e867b47a94df05188c08575e8B9a52F3F69c469";
const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_DECIMALS = 6;
const MAX_BLOCK_RANGE = 2000;
const SYNC_STATE_KEY = "cca_usdc_sync";

// ─── Initialize Clients ─────────────────────────────────────
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables");
  }
  return createClient(url, key);
}

function getViemClient() {
  const rpcUrl = process.env.BASE_RPC_URL;
  if (!rpcUrl) {
    throw new Error("Missing BASE_RPC_URL environment variable");
  }
  return createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });
}

// ─── Helper: Get the last processed block from Supabase ─────
async function getLastProcessedBlock(supabase: ReturnType<typeof createClient>): Promise<bigint> {
  const { data, error } = await supabase
    .from("cca_sync_state")
    .select("last_block")
    .eq("key", SYNC_STATE_KEY)
    .single();

  if (error || !data) {
    return BigInt(0);
  }

  return BigInt(data.last_block);
}

// ─── Helper: Save the last processed block to Supabase ──────
async function saveLastProcessedBlock(supabase: ReturnType<typeof createClient>, block: bigint) {
  await supabase
    .from("cca_sync_state")
    .upsert(
      {
        key: SYNC_STATE_KEY,
        last_block: Number(block),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
}

// ─── Helper: Compute median from an array of numbers ────────
function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ─── Main Sync Logic ─────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    // ── Step 1: Authenticate ──────────────────────────────────
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get("secret");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || secret !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ── Step 2: Initialize clients ────────────────────────────
    const supabase = getSupabaseAdmin();
    const viemClient = getViemClient();

    // ── Step 3: Determine block range ─────────────────────────
    const lastProcessedBlock = await getLastProcessedBlock(supabase);
    const currentBlock = await viemClient.getBlockNumber();

    const startBlock = lastProcessedBlock === BigInt(0)
      ? currentBlock - BigInt(10000)
      : lastProcessedBlock + BigInt(1);

    const endBlock = startBlock + BigInt(MAX_BLOCK_RANGE) > currentBlock
      ? currentBlock
      : startBlock + BigInt(MAX_BLOCK_RANGE);

    if (startBlock > currentBlock) {
      return NextResponse.json({
        success: true,
        message: "Already up to date",
        currentBlock: Number(currentBlock),
        lastProcessedBlock: Number(lastProcessedBlock),
      });
    }

    // ── Step 4: Fetch USDC Transfer events to the CCA contract ─
    const transferEvent = parseAbiItem(
      "event Transfer(address indexed from, address indexed to, uint256 value)"
    );

    const logs = await viemClient.getLogs({
      address: USDC_CONTRACT as `0x${string}`,
      event: transferEvent,
      args: {
        to: CCA_CONTRACT as `0x${string}`,
      },
      fromBlock: startBlock,
      toBlock: endBlock,
    });

    // ── Step 5: Process each transfer ─────────────────────────
    const newTransfers: {
      tx_hash: string;
      block_number: number;
      wallet: string;
      usdc_amount: number;
      raw_amount: string;
      timestamp: string;
    }[] = [];

    for (const log of logs) {
      const from = log.args.from as string;
      const rawValue = log.args.value as bigint;
      const usdcAmount = parseFloat(formatUnits(rawValue, USDC_DECIMALS));

      newTransfers.push({
        tx_hash: log.transactionHash,
        block_number: Number(log.blockNumber),
        wallet: from.toLowerCase(),
        usdc_amount: usdcAmount,
        raw_amount: rawValue.toString(),
        timestamp: new Date().toISOString(),
      });
    }

    // ── Step 6: Insert transfers into Supabase ────────────────
    if (newTransfers.length > 0) {
      const { error: insertError } = await supabase
        .from("cca_transfers")
        .upsert(newTransfers, { onConflict: "tx_hash" });

      if (insertError) {
        console.error("Error inserting transfers:", insertError);
        throw new Error(`Failed to insert transfers: ${insertError.message}`);
      }
    }

    // ── Step 7: Update per-wallet aggregates ──────────────────
    const { data: allTransfers, error: fetchError } = await supabase
      .from("cca_transfers")
      .select("wallet, usdc_amount");

    if (fetchError) {
      throw new Error(`Failed to fetch transfers: ${fetchError.message}`);
    }

    const walletMap = new Map<string, { total: number; count: number }>();
    for (const t of allTransfers || []) {
      const existing = walletMap.get(t.wallet) || { total: 0, count: 0 };
      existing.total += t.usdc_amount;
      existing.count += 1;
      walletMap.set(t.wallet, existing);
    }

    const walletRows = Array.from(walletMap.entries()).map(([wallet, data]) => ({
      wallet,
      total_usdc: data.total,
      bid_count: data.count,
      avg_bid: data.total / data.count,
      updated_at: new Date().toISOString(),
    }));

    if (walletRows.length > 0) {
      for (let i = 0; i < walletRows.length; i += 500) {
        const batch = walletRows.slice(i, i + 500);
        const { error: walletError } = await supabase
          .from("cca_wallets")
          .upsert(batch, { onConflict: "wallet" });

        if (walletError) {
          console.error("Error upserting wallets:", walletError);
        }
      }
    }

    // ── Step 8: Compute and store global stats ────────────────
    const allAmounts = (allTransfers || []).map((t) => t.usdc_amount);
    const totalUsdc = allAmounts.reduce((sum, v) => sum + v, 0);
    const totalBids = allAmounts.length;
    const uniqueWallets = walletMap.size;
    const avgBid = totalBids > 0 ? totalUsdc / totalBids : 0;
    const medianBid = computeMedian(allAmounts);
    const bidsUnder50 = allAmounts.filter((v) => v < 50).length;
    const bidsUnder100 = allAmounts.filter((v) => v < 100).length;
    const pctUnder50 = totalBids > 0 ? (bidsUnder50 / totalBids) * 100 : 0;
    const pctUnder100 = totalBids > 0 ? (bidsUnder100 / totalBids) * 100 : 0;

    const sortedWallets = Array.from(walletMap.entries())
      .sort((a, b) => b[1].total - a[1].total);
    const top10Total = sortedWallets.slice(0, 10).reduce((sum, [, d]) => sum + d.total, 0);
    const top10Share = totalUsdc > 0 ? (top10Total / totalUsdc) * 100 : 0;

    const stats = {
      id: "latest",
      total_usdc: totalUsdc,
      total_bids: totalBids,
      unique_wallets: uniqueWallets,
      avg_bid: avgBid,
      median_bid: medianBid,
      pct_under_50: pctUnder50,
      pct_under_100: pctUnder100,
      top_10_share: top10Share,
      last_block: Number(endBlock),
      updated_at: new Date().toISOString(),
    };

    await supabase
      .from("cca_stats_latest")
      .upsert(stats, { onConflict: "id" });

    // ── Step 9: Save sync state ───────────────────────────────
    await saveLastProcessedBlock(supabase, endBlock);

    // ── Step 10: Return summary ───────────────────────────────
    return NextResponse.json({
      success: true,
      blocksProcessed: Number(endBlock - startBlock),
      blockRange: {
        from: Number(startBlock),
        to: Number(endBlock),
      },
      newTransfers: newTransfers.length,
      totalTransfersInDb: totalBids,
      currentBlock: Number(currentBlock),
      caughtUp: endBlock >= currentBlock,
    });
  } catch (err: unknown) {
    console.error("Sync error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
