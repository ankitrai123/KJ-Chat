import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env.server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { processStorageDeletions, removeOrphanUploads } from "@/lib/storage/cleanup.server";

function authorized(request: Request): boolean {
  if (!serverEnv.cronSecret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${serverEnv.cronSecret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Periodic housekeeping (Vercel Cron, see vercel.json; Vercel sends CRON_SECRET as a bearer
 * token): expires stale calls, removes orphaned conversations, clears old rate-limit rows,
 * deletes queued storage objects and abandoned uploads.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = getSupabaseAdminClient();
  const { data: maintenance, error } = await admin.rpc("run_maintenance");
  const removedObjects = await processStorageDeletions(admin, 1000).catch(() => 0);
  const removedOrphans = await removeOrphanUploads(admin).catch(() => 0);
  return NextResponse.json({
    ok: !error,
    maintenance: maintenance ?? null,
    removedObjects,
    removedOrphans,
  });
}
