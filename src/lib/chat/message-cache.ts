import type { ChatMessage, Reaction } from "@/types/chat";
import { toMicros } from "./time";

/**
 * Pure helpers for the TanStack infinite-query cache that holds a conversation's messages.
 *
 * Layout: pages[0] is the NEWEST page; each page's messages are sorted ascending. Older pages
 * are appended as the user scrolls up. New (realtime / optimistic) messages go into pages[0].
 * Every operation is idempotent so duplicate realtime events and HTTP responses converge.
 */
export interface MessagePage {
  messages: ChatMessage[];
  /** Id of the oldest message in this page when older history exists, else null. */
  nextCursor: string | null;
}

export interface MessagePages {
  pages: MessagePage[];
  pageParams: (string | null)[];
}

export function compareMessages(a: ChatMessage, b: ChatMessage): number {
  // Unconfirmed local messages always sort after confirmed ones.
  const aPending = a.localStatus === "pending" || a.localStatus === "failed";
  const bPending = b.localStatus === "pending" || b.localStatus === "failed";
  if (aPending !== bPending) return aPending ? 1 : -1;
  const diff = toMicros(a.created_at) - toMicros(b.created_at);
  if (diff !== 0) return diff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function sameMessage(a: ChatMessage, b: ChatMessage): boolean {
  if (a.id === b.id) return true;
  return Boolean(a.client_id && b.client_id && a.client_id === b.client_id && a.sender_id === b.sender_id);
}

/** Server data wins, except that a newer `updated_at` is never overwritten by an older one. */
function merge(existing: ChatMessage, incoming: ChatMessage): ChatMessage {
  if (existing.localStatus === "sent" && incoming.localStatus === "sent" && toMicros(incoming.updated_at) < toMicros(existing.updated_at)) {
    return existing;
  }
  return { ...incoming, localPayload: incoming.localStatus === "sent" ? undefined : incoming.localPayload ?? existing.localPayload };
}

export function emptyPages(): MessagePages {
  return { pages: [{ messages: [], nextCursor: null }], pageParams: [null] };
}

export function upsertMessages(data: MessagePages | undefined, incoming: ChatMessage[]): MessagePages {
  const base = data && data.pages.length > 0 ? data : emptyPages();
  let pages = base.pages.map((p) => ({ ...p, messages: p.messages }));

  for (const message of incoming) {
    let found = false;
    pages = pages.map((page) => {
      const index = page.messages.findIndex((m) => sameMessage(m, message));
      if (index === -1) return page;
      found = true;
      const messages = page.messages.slice();
      messages[index] = merge(messages[index], message);
      messages.sort(compareMessages);
      return { ...page, messages };
    });

    if (!found) {
      const [first, ...rest] = pages;
      // New messages land in the newest page; flattenMessages() sorts across pages anyway.
      const messages = [...first.messages, message].sort(compareMessages);
      pages = [{ ...first, messages }, ...rest];
    }
  }

  return { ...base, pages };
}

export function updateMessage(
  data: MessagePages | undefined,
  idOrClientId: string,
  updater: (message: ChatMessage) => ChatMessage,
): MessagePages | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => {
      const index = page.messages.findIndex((m) => m.id === idOrClientId || m.client_id === idOrClientId);
      if (index === -1) return page;
      const messages = page.messages.slice();
      messages[index] = updater(messages[index]);
      return { ...page, messages };
    }),
  };
}

export function removeMessage(data: MessagePages | undefined, idOrClientId: string): MessagePages | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      messages: page.messages.filter((m) => m.id !== idOrClientId && m.client_id !== idOrClientId),
    })),
  };
}

export function findMessage(data: MessagePages | undefined, id: string): ChatMessage | undefined {
  if (!data) return undefined;
  for (const page of data.pages) {
    const found = page.messages.find((m) => m.id === id || m.client_id === id);
    if (found) return found;
  }
  return undefined;
}

export function addReaction(data: MessagePages | undefined, messageId: string, reaction: Reaction): MessagePages | undefined {
  return updateMessage(data, messageId, (message) => {
    if (message.reactions.some((r) => r.id === reaction.id || (r.user_id === reaction.user_id && r.emoji === reaction.emoji))) {
      return {
        ...message,
        reactions: message.reactions.map((r) => (r.user_id === reaction.user_id && r.emoji === reaction.emoji ? reaction : r)),
      };
    }
    return { ...message, reactions: [...message.reactions, reaction] };
  });
}

export function removeReaction(
  data: MessagePages | undefined,
  messageId: string,
  match: { id?: string; user_id?: string; emoji?: string },
): MessagePages | undefined {
  return updateMessage(data, messageId, (message) => ({
    ...message,
    reactions: message.reactions.filter((r) =>
      match.id ? r.id !== match.id : !(r.user_id === match.user_id && r.emoji === match.emoji),
    ),
  }));
}

/** Oldest-to-newest list across all loaded pages. */
export function flattenMessages(data: MessagePages | undefined): ChatMessage[] {
  if (!data) return [];
  const all: ChatMessage[] = [];
  for (let i = data.pages.length - 1; i >= 0; i -= 1) all.push(...data.pages[i].messages);
  // Pages can overlap after realtime inserts racing with pagination; de-duplicate by id.
  const seen = new Set<string>();
  return all.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true))).sort(compareMessages);
}

export interface ReactionGroup {
  emoji: string;
  count: number;
  userIds: string[];
  mine: boolean;
}

export function groupReactions(reactions: Reaction[], myUserId: string): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup>();
  for (const r of reactions) {
    const group = groups.get(r.emoji) ?? { emoji: r.emoji, count: 0, userIds: [], mine: false };
    group.count += 1;
    group.userIds.push(r.user_id);
    if (r.user_id === myUserId) group.mine = true;
    groups.set(r.emoji, group);
  }
  return Array.from(groups.values());
}
