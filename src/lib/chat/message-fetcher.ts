"use client";

import { fromDatabaseError } from "@/lib/errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { type ChatMessage, normalizeMessage } from "@/types/chat";

const PAGE_SIZE = 40;

export async function fetchMessagePage(conversationId: string, beforeId: string | null) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("get_messages", {
    p_conversation_id: conversationId,
    ...(beforeId ? { p_before_id: beforeId } : {}),
    p_limit: PAGE_SIZE,
  });
  if (error) throw fromDatabaseError(error, "Could not load messages.");
  const rows = data ?? [];
  const messages = rows.map(normalizeMessage).reverse();
  return { messages, nextCursor: rows.length === PAGE_SIZE ? rows[rows.length - 1].id : null };
}

/**
 * Coalesces detail lookups for messages announced by realtime events: many events in quick
 * succession (e.g. after reconnecting) become a single RPC call.
 */
let pendingIds = new Set<string>();
let waiters: { ids: string[]; resolve: (m: ChatMessage[]) => void; reject: (e: unknown) => void }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

export function fetchMessagesByIds(ids: string[]): Promise<ChatMessage[]> {
  return new Promise((resolve, reject) => {
    ids.forEach((id) => pendingIds.add(id));
    waiters.push({ ids, resolve, reject });
    if (!timer) timer = setTimeout(flush, 40);
  });
}

async function flush() {
  const ids = Array.from(pendingIds);
  const currentWaiters = waiters;
  pendingIds = new Set();
  waiters = [];
  timer = null;

  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.rpc("get_messages_by_ids", { p_ids: ids });
    if (error) throw fromDatabaseError(error);
    const byId = new Map((data ?? []).map((row) => [row.id, normalizeMessage(row)]));
    for (const waiter of currentWaiters) {
      waiter.resolve(waiter.ids.map((id) => byId.get(id)).filter((m): m is ChatMessage => Boolean(m)));
    }
  } catch (error) {
    currentWaiters.forEach((w) => w.reject(error));
  }
}
