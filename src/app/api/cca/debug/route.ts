/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb: any = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const results: Record<string, any> = {};

  // Test combos for cca_transfers
  const combos = [
    { label: "tx_hash+block_number+wallet+usdc_amount", row: { tx_hash: "0xT1", block_number: 1, wallet: "0xw", usdc_amount: 1.0 }},
    { label: "tx_hash+block+wallet+amount", row: { tx_hash: "0xT2", block: 1, wallet: "0xw", amount: 1.0 }},
    { label: "tx_hash+block_number+from_address+usdc_amount", row: { tx_hash: "0xT3", block_number: 1, from_address: "0xw", usdc_amount: 1.0 }},
    { label: "tx_hash+block_number+wallet+usdc_amount+created_at", row: { tx_hash: "0xT4", block_number: 1, wallet: "0xw", usdc_amount: 1.0, created_at: new Date().toISOString() }},
    { label: "just_tx_hash", row: { tx_hash: "0xT5" }},
    { label: "tx_hash+wallet+usdc_amount", row: { tx_hash: "0xT6", wallet: "0xw", usdc_amount: 1.0 }},
  ];

  for (const c of combos) {
    const { error } = await sb.from("cca_transfers").upsert(c.row, { onConflict: "tx_hash" });
    results[c.label] = error?.message || "OK";
  }

  // Also check cca_wallets columns
  const walletCombos = [
    { label: "wallet+total_usdc+bid_count+avg_bid", row: { wallet: "0xWt1", total_usdc: 1, bid_count: 1, avg_bid: 1, updated_at: new Date().toISOString() }},
    { label: "wallet+total_usdc+bid_count", row: { wallet: "0xWt2", total_usdc: 1, bid_count: 1 }},
  ];

  for (const c of walletCombos) {
    const { error } = await sb.from("cca_wallets").upsert(c.row, { onConflict: "wallet" });
    results["wallets_" + c.label] = error?.message || "OK";
  }

  // Check cca_stats_latest columns
  const statsCombos = [
    { label: "full_stats", row: {
      id: "test", total_usdc: 1, total_bids: 1, unique_wallets: 1,
      avg_bid: 1, median_bid: 1, pct_bids_lt_50: 0, pct_bids_lt_100: 0,
      top10_share: 0, top50_share: 0, last_processed_block: 1, updated_at: new Date().toISOString()
    }},
    { label: "minimal_stats", row: { id: "test2", total_usdc: 1, updated_at: new Date().toISOString() }},
  ];

  for (const c of statsCombos) {
    const { error } = await sb.from("cca_stats_latest").upsert(c.row, { onConflict: "id" });
    results["stats_" + c.label] = error?.message || "OK";
  }

  // Clean up test rows
  await sb.from("cca_transfers").delete().in("tx_hash", ["0xT1","0xT2","0xT3","0xT4","0xT5","0xT6","0xTEST","0xTEST2"]);
  await sb.from("cca_sync_state").delete().eq("id", "test_debug");
  await sb.from("cca_wallets").delete().in("wallet", ["0xWt1","0xWt2"]);
  await sb.from("cca_stats_latest").delete().in("id", ["test","test2"]);

  return NextResponse.json(results);
}
