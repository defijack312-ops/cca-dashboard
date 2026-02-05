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

  // We know tx_hash and block_number exist. Try common column names one at a time.
  const transferCols = [
    "wallet", "from_address", "from_wallet", "sender", "from_addr", "address",
    "usdc_amount", "amount", "value", "usdc_value", "transfer_amount",
    "timestamp", "created_at", "block_timestamp", "time", "transferred_at",
    "raw_amount", "raw_value",
    "to_address", "to_wallet", "recipient",
    "log_index", "tx_index",
  ];

  for (const col of transferCols) {
    const row: any = { tx_hash: `0xProbe_${col}`, block_number: 1 };
    row[col] = col.includes("amount") || col.includes("value") ? 1.0 : "test";
    const { error } = await sb.from("cca_transfers").upsert(row, { onConflict: "tx_hash" });
    if (error?.message?.includes("schema cache")) {
      results[`transfers.${col}`] = "NOT FOUND";
    } else if (error) {
      results[`transfers.${col}`] = `EXISTS (err: ${error.message})`;
    } else {
      results[`transfers.${col}`] = "EXISTS - OK";
    }
  }

  // Same for cca_wallets - try common PK names
  const walletPKs = ["wallet", "address", "wallet_address", "id", "addr"];
  for (const col of walletPKs) {
    const row: any = {};
    row[col] = "0xProbeWallet";
    const { error } = await sb.from("cca_wallets").insert(row);
    if (error?.message?.includes("schema cache")) {
      results[`wallets.${col}`] = "NOT FOUND";
    } else if (error) {
      results[`wallets.${col}`] = `EXISTS (err: ${error.message})`;
    } else {
      results[`wallets.${col}`] = "EXISTS - OK";
    }
  }

  const walletCols = ["total_usdc", "total_amount", "total_value", "bid_count", "num_bids", "count", "avg_bid", "average_bid", "updated_at", "created_at"];
  for (const col of walletCols) {
    // Use 'id' as PK guess for now
    const row: any = { id: `probe_${col}` };
    row[col] = typeof col === "string" && col.includes("at") ? new Date().toISOString() : 1;
    const { error } = await sb.from("cca_wallets").upsert(row, { onConflict: "id" });
    if (error?.message?.includes("schema cache")) {
      results[`wallets.${col}`] = "NOT FOUND";
    } else if (error) {
      results[`wallets.${col}`] = `EXISTS (err: ${error.message})`;
    } else {
      results[`wallets.${col}`] = "EXISTS - OK";
    }
  }

  // Clean up probes
  await sb.from("cca_transfers").delete().like("tx_hash", "0xProbe_%");
  await sb.from("cca_wallets").delete().like("id", "probe_%");
  await sb.from("cca_wallets").delete().eq("address", "0xProbeWallet");
  await sb.from("cca_wallets").delete().eq("wallet_address", "0xProbeWallet");

  return NextResponse.json(results);
}
