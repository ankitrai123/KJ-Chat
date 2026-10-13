import type { Database } from "@/types/database";

type Tables = Database["public"]["Tables"];

/** Events fanned out by the RealtimeProvider to feature code (calls, notifications, views). */
export interface RealtimeEvents {
  "message:insert": Tables["messages"]["Row"];
  "message:update": Tables["messages"]["Row"];
  "call:session": Tables["call_sessions"]["Row"];
  "call:participant": Tables["call_participants"]["Row"];
  "membership:removed": { conversation_id: string };
  "conversation:deleted": { conversation_id: string };
  /** Fired after the realtime connection recovers from an interruption. */
  reconnected: Record<string, never>;
}

type Handler<T> = (payload: T) => void;

class EventBus<E extends object> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(event: K, handler: Handler<E[K]>): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler as Handler<never>);
    this.handlers.set(event, set);
    return () => set.delete(handler as Handler<never>);
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        (handler as Handler<E[K]>)(payload);
      } catch (error) {
        console.error("[realtime-bus] handler failed", error instanceof Error ? error.name : error);
      }
    }
  }
}

export const realtimeBus = new EventBus<RealtimeEvents>();
