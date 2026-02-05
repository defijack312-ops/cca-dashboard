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

  // Try to read sync state
  const { data: syncData, error: syncError } = await sb
    .from("cca_sync_state")
    .select("*")
    .limit(5);

  // Try a raw insert to test columns
  const { data: testInsert, error: insertError } = await sb
    .from("cca_sync_state")
    .upsert(
      { id: "test_debug", last_processed_block: 0, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    )
    .select();

  // Try with "key" column instead
  const { data: testInsert2, error: insertError2 } = await sb
    .from("cca_sync_state")
    .upsert(
      { key: "test_debug2", last_processed_block: 0, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    )
    .select();

  // Check transfers table
  const { data: transferData, error: transferError } = await sb
    .from("cca_transfers")
    .select("*")
    .limit(3);

  return NextResponse.json({
    syncState: { data: syncData, error: syncError?.message || null },
    insertWithId: { data: testInsert, error: insertError?.message || null },
    insertWithKey: { data: testInsert2, error: insertError2?.message || null },
    transfers: { data: transferData, error: transferError?.message || null },
  });
}
