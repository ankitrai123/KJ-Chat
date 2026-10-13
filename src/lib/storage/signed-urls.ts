"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Batched, cached signed-URL resolution for private storage objects. Many avatars and media
 * items render at once, so requests made in the same tick are combined into one
 * createSignedUrls() call per bucket. URLs are reused until shortly before they expire.
 */
export type Bucket = "attachments" | "avatars";

const TTL_SECONDS = 60 * 60;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

interface Entry {
  url: string;
  expiresAt: number;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<string | null>>();
const queues = new Map<Bucket, Map<string, { resolve: (url: string | null) => void }[]>>();
let flushScheduled = false;

const keyOf = (bucket: Bucket, path: string) => `${bucket}:${path}`;

export function getCachedSignedUrl(bucket: Bucket, path: string): string | null {
  const entry = cache.get(keyOf(bucket, path));
  if (!entry || entry.expiresAt - REFRESH_MARGIN_MS < Date.now()) return null;
  return entry.url;
}

export function requestSignedUrl(bucket: Bucket, path: string): Promise<string | null> {
  const cached = getCachedSignedUrl(bucket, path);
  if (cached) return Promise.resolve(cached);

  const key = keyOf(bucket, path);
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = new Promise<string | null>((resolve) => {
    const queue = queues.get(bucket) ?? new Map();
    const waiters = queue.get(path) ?? [];
    waiters.push({ resolve });
    queue.set(path, waiters);
    queues.set(bucket, queue);
    scheduleFlush();
  }).finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    for (const [bucket, queue] of queues) {
      queues.delete(bucket);
      void flushBucket(bucket, queue);
    }
  }, 16);
}

async function flushBucket(bucket: Bucket, queue: Map<string, { resolve: (url: string | null) => void }[]>) {
  const paths = Array.from(queue.keys());
  const resolveAll = (path: string, url: string | null) => {
    for (const waiter of queue.get(path) ?? []) waiter.resolve(url);
  };

  try {
    const supabase = getSupabaseBrowserClient();
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls(chunk, TTL_SECONDS);
      if (error || !data) {
        chunk.forEach((p) => resolveAll(p, null));
        continue;
      }
      const byPath = new Map<string, string | null>();
      for (const item of data) {
        if (item.path) byPath.set(item.path, item.error ? null : item.signedUrl);
      }
      for (const path of chunk) {
        const url = byPath.get(path) ?? null;
        if (url) cache.set(keyOf(bucket, path), { url, expiresAt: Date.now() + TTL_SECONDS * 1000 });
        resolveAll(path, url);
      }
    }
  } catch {
    paths.forEach((p) => resolveAll(p, null));
  }
}

/** One-off URL that makes the browser download the file under its original name. */
export async function createDownloadUrl(bucket: Bucket, path: string, fileName: string): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 120, { download: fileName });
  return error ? null : data.signedUrl;
}

export function forgetSignedUrl(bucket: Bucket, path: string) {
  cache.delete(keyOf(bucket, path));
}
