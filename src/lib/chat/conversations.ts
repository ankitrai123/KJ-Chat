import type { ConversationSummary } from "@/types/chat";
import { conversationTitle } from "@/types/chat";
import { toMicros } from "./time";

export type ConversationFilter = "all" | "unread" | "groups" | "direct" | "archived";

export function isMuted(conversation: Pick<ConversationSummary, "muted_until">, now = Date.now()): boolean {
  return Boolean(conversation.muted_until && Date.parse(conversation.muted_until) > now);
}

/** Pinned first (most recently pinned on top), then by latest activity. */
export function sortConversations(list: ConversationSummary[]): ConversationSummary[] {
  return [...list].sort((a, b) => {
    if (Boolean(a.pinned_at) !== Boolean(b.pinned_at)) return a.pinned_at ? -1 : 1;
    if (a.pinned_at && b.pinned_at) return toMicros(b.pinned_at) - toMicros(a.pinned_at);
    const aTime = toMicros(a.last_message_at ?? a.created_at);
    const bTime = toMicros(b.last_message_at ?? b.created_at);
    return bTime - aTime;
  });
}

export function filterConversations(list: ConversationSummary[], filter: ConversationFilter, query = ""): ConversationSummary[] {
  const q = query.trim().toLowerCase();
  return list.filter((c) => {
    if (filter === "archived") {
      if (!c.archived_at) return false;
    } else if (c.archived_at) {
      return false;
    }
    if (filter === "unread" && c.unread_count === 0) return false;
    if (filter === "groups" && c.type !== "group") return false;
    if (filter === "direct" && c.type !== "direct") return false;
    if (!q) return true;
    const title = conversationTitle(c).toLowerCase();
    const username = c.peer?.username?.toLowerCase() ?? "";
    return title.includes(q) || username.includes(q);
  });
}

/** Total unread across conversations, ignoring muted ones (used for badges and the tab title). */
export function totalUnread(list: ConversationSummary[], now = Date.now()): number {
  return list.reduce((sum, c) => {
    if (c.archived_at) return sum;
    if (isMuted(c, now) || c.notification_level === "none") return sum + (c.mention_count > 0 ? c.mention_count : 0);
    if (c.notification_level === "mentions") return sum + c.mention_count;
    return sum + c.unread_count;
  }, 0);
}

export function formatUnread(count: number): string {
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}
