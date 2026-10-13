"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState } from "react";
import type * as React from "react";
import { addReaction, type MessagePages, upsertMessages } from "@/lib/chat/message-cache";
import { fetchMessagesByIds } from "@/lib/chat/message-fetcher";
import { queryKeys } from "@/lib/query-keys";
import { realtimeBus } from "@/lib/realtime/bus";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { MemberWithProfile } from "@/types/chat";
import type { Database } from "@/types/database";

type Tables = Database["public"]["Tables"];
export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline";

const RealtimeStatusContext = createContext<ConnectionStatus>("connecting");

export function useRealtimeStatus() {
  return useContext(RealtimeStatusContext);
}

function debounce(fn: () => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  };
  run.cancel = () => timer && clearTimeout(timer);
  return run;
}

/**
 * One app-wide subscription that keeps the TanStack Query cache in sync with the database.
 *
 * Postgres Changes are RLS-filtered per subscriber, so a single unfiltered subscription per
 * table only ever delivers rows the user may read. The database row stays the source of truth:
 * events trigger targeted refetches/cache updates rather than being trusted blindly, and every
 * reconnect invalidates all queries so nothing missed while offline is lost.
 */
export function RealtimeProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let disposed = false;
    let channels: RealtimeChannel[] = [];
    let attempt = 0;
    let everConnected = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const refreshConversations = debounce(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    }, 250);

    const markDelivered = debounce(() => {
      void supabase.rpc("mark_delivered");
    }, 1000);

    const upsertFromServer = async (conversationId: string, messageId: string, insertIfMissing: boolean) => {
      const key = queryKeys.messages(conversationId);
      const cached = queryClient.getQueryData<MessagePages>(key);
      if (!cached) return;
      const present = cached.pages.some((p) => p.messages.some((m) => m.id === messageId));
      if (!present && !insertIfMissing) return;
      try {
        const [message] = await fetchMessagesByIds([messageId]);
        if (message) queryClient.setQueryData<MessagePages>(key, (data) => upsertMessages(data, [message]));
      } catch {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    };

    const teardown = async () => {
      const toRemove = channels;
      channels = [];
      await Promise.all(toRemove.map((c) => supabase.removeChannel(c)));
    };

    const scheduleReconnect = () => {
      if (disposed || retryTimer) return;
      const delay = Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
      attempt += 1;
      retryTimer = setTimeout(async () => {
        retryTimer = null;
        await teardown();
        if (!disposed) void connect();
      }, delay);
    };

    const onStatus = (state: `${"SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR"}`) => {
      if (disposed) return;
      if (state === "SUBSCRIBED") {
        setStatus("connected");
        if (everConnected) {
          void queryClient.invalidateQueries();
          realtimeBus.emit("reconnected", {});
        }
        everConnected = true;
        attempt = 0;
        markDelivered();
      } else {
        setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "reconnecting");
        scheduleReconnect();
      }
    };

    const connect = async () => {
      try {
        await supabase.realtime.setAuth();
      } catch {
        // Token refresh failed (offline); the retry loop will try again.
      }
      if (disposed) return;

      const db = supabase
        .channel(`db:${userId}`)
        .on<Tables["messages"]["Row"]>("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, ({ new: row }) => {
          realtimeBus.emit("message:insert", row);
          void upsertFromServer(row.conversation_id, row.id, true);
          refreshConversations();
          if (row.sender_id !== userId) markDelivered();
        })
        .on<Tables["messages"]["Row"]>("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, ({ new: row }) => {
          realtimeBus.emit("message:update", row);
          void upsertFromServer(row.conversation_id, row.id, false);
          refreshConversations();
        })
        .on<Tables["message_reactions"]["Row"]>(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "message_reactions" },
          ({ new: row }) => {
            queryClient.setQueryData<MessagePages>(queryKeys.messages(row.conversation_id), (data) =>
              addReaction(data, row.message_id, { id: row.id, user_id: row.user_id, emoji: row.emoji, created_at: row.created_at }),
            );
          },
        )
        // INSERT and UPDATE only: DELETE notifications bypass RLS, so they're never subscribed to.
        .on<Tables["conversation_members"]["Row"]>(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "conversation_members" },
          ({ new: row }) => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.members(row.conversation_id) });
            if (row.user_id === userId) refreshConversations();
          },
        )
        .on<Tables["conversation_members"]["Row"]>(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "conversation_members" },
          ({ new: row }) => {
            // Receipt updates: patch in place instead of refetching the member list.
            queryClient.setQueryData<MemberWithProfile[]>(queryKeys.members(row.conversation_id), (members) =>
              members?.map((m) =>
                m.user_id === row.user_id
                  ? { ...m, role: row.role, last_read_at: row.last_read_at, last_delivered_at: row.last_delivered_at }
                  : m,
              ),
            );
          },
        )
        .on<Tables["conversations"]["Row"]>("postgres_changes", { event: "UPDATE", schema: "public", table: "conversations" }, () => {
          refreshConversations();
        })
        .on<Tables["conversation_preferences"]["Row"]>(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "conversation_preferences", filter: `user_id=eq.${userId}` },
          () => refreshConversations(),
        )
        .on<Tables["pinned_messages"]["Row"]>("postgres_changes", { event: "INSERT", schema: "public", table: "pinned_messages" }, ({ new: row }) => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.pins(row.conversation_id) });
        })
        .on<Tables["call_sessions"]["Row"]>("postgres_changes", { event: "INSERT", schema: "public", table: "call_sessions" }, ({ new: row }) => {
          realtimeBus.emit("call:session", row);
          refreshConversations();
        })
        .on<Tables["call_sessions"]["Row"]>("postgres_changes", { event: "UPDATE", schema: "public", table: "call_sessions" }, ({ new: row }) => {
          realtimeBus.emit("call:session", row);
          refreshConversations();
        })
        .on<Tables["call_participants"]["Row"]>(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "call_participants" },
          ({ new: row }) => realtimeBus.emit("call:participant", row),
        )
        .on<Tables["call_participants"]["Row"]>(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "call_participants" },
          ({ new: row }) => realtimeBus.emit("call:participant", row),
        );

      // Personal topic for server-side notices that postgres_changes can't deliver.
      const personal = supabase
        .channel(`user:${userId}`, { config: { private: true } })
        .on("broadcast", { event: "membership_removed" }, ({ payload }) => {
          const conversationId = String(payload?.conversation_id ?? "");
          queryClient.removeQueries({ queryKey: queryKeys.messages(conversationId) });
          refreshConversations();
          realtimeBus.emit("membership:removed", { conversation_id: conversationId });
        })
        .on("broadcast", { event: "conversation_deleted" }, ({ payload }) => {
          const conversationId = String(payload?.conversation_id ?? "");
          queryClient.removeQueries({ queryKey: queryKeys.messages(conversationId) });
          refreshConversations();
          realtimeBus.emit("conversation:deleted", { conversation_id: conversationId });
        });

      channels = [db, personal];
      db.subscribe((state) => onStatus(state));
      personal.subscribe();
    };

    const onOnline = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      attempt = 0;
      void queryClient.invalidateQueries();
      void teardown().then(() => {
        if (!disposed) void connect();
      });
    };
    const onOffline = () => setStatus("offline");

    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > 60_000) {
        // Background tabs can miss events when the OS suspends sockets; resync on return.
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
        void queryClient.invalidateQueries({ queryKey: ["messages"], refetchType: "active" });
        markDelivered();
      }
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);
    void connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      refreshConversations.cancel();
      markDelivered.cancel();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
      void teardown();
    };
  }, [queryClient, userId]);

  return <RealtimeStatusContext value={status}>{children}</RealtimeStatusContext>;
}
