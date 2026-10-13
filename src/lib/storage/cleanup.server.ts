import "server-only";

import type { AdminSupabase } from "@/lib/supabase/admin";

/**
 * Drains the storage deletion queue that database triggers fill when attachments, avatars or
 * whole conversations are deleted. Failed removals are re-queued for the next run.
 */
export async function processStorageDeletions(admin: AdminSupabase, limit = 200): Promise<number> {
  const { data, error } = await admin.rpc("dequeue_storage_deletions", { p_limit: limit });
  if (error || !data?.length) return 0;

  const byBucket = new Map<string, string[]>();
  for (const item of data) {
    const list = byBucket.get(item.bucket_id) ?? [];
    list.push(item.path);
    byBucket.set(item.bucket_id, list);
  }

  let removed = 0;
  const failed: { bucket_id: string; path: string }[] = [];
  for (const [bucket, paths] of byBucket) {
    const { error: removeError } = await admin.storage.from(bucket).remove(paths);
    if (removeError) failed.push(...paths.map((path) => ({ bucket_id: bucket, path })));
    else removed += paths.length;
  }

  if (failed.length) await admin.rpc("requeue_storage_deletions", { p_items: failed });
  return removed;
}

export async function removeOrphanUploads(admin: AdminSupabase): Promise<number> {
  const { data, error } = await admin.rpc("list_orphan_uploads", { p_older_than_hours: 24, p_limit: 500 });
  if (error || !data?.length) return 0;
  const paths = data.map((row) => row.path);
  const { error: removeError } = await admin.storage.from("attachments").remove(paths);
  return removeError ? 0 : paths.length;
}
