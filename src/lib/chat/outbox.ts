"use client";

import type { ChatMessage } from "@/types/chat";

/**
 * Holds messages that haven't been confirmed by the server (pending or failed), separately
 * from the server-backed query cache. Refetches can therefore never drop an unsent message.
 * Failed text-only messages are persisted to localStorage so they survive a reload and can be
 * retried; attachments can't be persisted (File objects) and are kept in memory only.
 */
type Listener = () => void;

const EMPTY: ChatMessage[] = [];

class Outbox {
  private byConversation = new Map<string, ChatMessage[]>();
  private listeners = new Set<Listener>();
  private storageKey: string | null = null;

  init(userId: string) {
    const key = `kj:outbox:${userId}`;
    if (this.storageKey === key) return;
    this.storageKey = key;
    this.byConversation.clear();
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const saved = JSON.parse(raw) as ChatMessage[];
        for (const message of saved) {
          this.push({ ...message, localStatus: "failed", localError: message.localError ?? "Not sent. Tap to retry." });
        }
      }
    } catch {
      // Corrupt or unavailable storage: start empty.
    }
    this.emit();
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get(conversationId: string): ChatMessage[] {
    return this.byConversation.get(conversationId) ?? EMPTY;
  }

  find(clientId: string): ChatMessage | undefined {
    for (const list of this.byConversation.values()) {
      const found = list.find((m) => m.client_id === clientId);
      if (found) return found;
    }
    return undefined;
  }

  add(message: ChatMessage) {
    this.push(message);
    this.persistAndEmit();
  }

  update(clientId: string, updater: (message: ChatMessage) => ChatMessage) {
    for (const [conversationId, list] of this.byConversation) {
      const index = list.findIndex((m) => m.client_id === clientId);
      if (index === -1) continue;
      const next = list.slice();
      next[index] = updater(list[index]);
      this.byConversation.set(conversationId, next);
      this.persistAndEmit();
      return;
    }
  }

  remove(clientId: string) {
    for (const [conversationId, list] of this.byConversation) {
      if (!list.some((m) => m.client_id === clientId)) continue;
      const next = list.filter((m) => m.client_id !== clientId);
      if (next.length) this.byConversation.set(conversationId, next);
      else this.byConversation.delete(conversationId);
      this.persistAndEmit();
      return;
    }
  }

  failedCount(): number {
    let count = 0;
    for (const list of this.byConversation.values()) count += list.filter((m) => m.localStatus === "failed").length;
    return count;
  }

  all(): ChatMessage[] {
    return Array.from(this.byConversation.values()).flat();
  }

  private push(message: ChatMessage) {
    const list = this.byConversation.get(message.conversation_id) ?? [];
    this.byConversation.set(message.conversation_id, [...list.filter((m) => m.client_id !== message.client_id), message]);
  }

  private persistAndEmit() {
    if (this.storageKey) {
      try {
        const persistable = this.all().filter((m) => !m.localPayload?.attachments?.length);
        window.localStorage.setItem(this.storageKey, JSON.stringify(persistable));
      } catch {
        // Storage full or blocked; in-memory state still works.
      }
    }
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}

export const outbox = new Outbox();
export const EMPTY_OUTBOX = EMPTY;
