"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { type MessagePages, removeReaction } from "@/lib/chat/message-cache";
import { queryKeys } from "@/lib/query-keys";
import { realtimeBus } from "@/lib/realtime/bus";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const TYPING_TTL_MS = 6000;
const TYPING_THROTTLE_MS = 2500;

/**
 * Private broadcast channel for one open conversation (members only, enforced by Realtime
 * authorization policies): ephemeral typing signals plus server-sent deletion notices.
 */
export function useConversationChannel(conversationId: string, userId: string) {
  const queryClient = useQueryClient();
  const [typing, setTyping] = useState<Record<string, number>>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSentRef = useRef(0);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let disposed = false;
    const channel = supabase.channel(`conversation:${conversationId}`, { config: { private: true, broadcast: { self: false } } });

    channel
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const from = String(payload?.user_id ?? "");
        if (!from || from === userId) return;
        setTyping((current) => {
          const next = { ...current };
          if (payload?.typing === false) delete next[from];
          else next[from] = Date.now() + TYPING_TTL_MS;
          return next;
        });
      })
      .on("broadcast", { event: "reaction_removed" }, ({ payload }) => {
        const messageId = String(payload?.message_id ?? "");
        if (!messageId) return;
        queryClient.setQueryData<MessagePages>(queryKeys.messages(conversationId), (data) =>
          removeReaction(data, messageId, payload?.id ? { id: String(payload.id) } : { user_id: String(payload?.user_id), emoji: String(payload?.emoji) }),
        );
      })
      .on("broadcast", { event: "pin_removed" }, () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.pins(conversationId) });
      });

    void supabase.realtime.setAuth().finally(() => {
      if (!disposed) channel.subscribe();
    });
    channelRef.current = channel;

    // A new message from someone means they've stopped typing.
    const offMessage = realtimeBus.on("message:insert", (row) => {
      if (row.conversation_id !== conversationId || !row.sender_id) return;
      const sender = row.sender_id;
      setTyping((current) => {
        if (!(sender in current)) return current;
        const next = { ...current };
        delete next[sender];
        return next;
      });
    });

    const sweep = setInterval(() => {
      setTyping((current) => {
        const now = Date.now();
        const entries = Object.entries(current).filter(([, expires]) => expires > now);
        return entries.length === Object.keys(current).length ? current : Object.fromEntries(entries);
      });
    }, 1500);

    return () => {
      disposed = true;
      offMessage();
      clearInterval(sweep);
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, queryClient, userId]);

  const notifyTyping = useCallback(
    (isTyping: boolean) => {
      const channel = channelRef.current;
      if (!channel) return;
      const now = Date.now();
      if (isTyping && now - lastSentRef.current < TYPING_THROTTLE_MS) return;
      lastSentRef.current = isTyping ? now : 0;
      void channel.send({ type: "broadcast", event: "typing", payload: { user_id: userId, typing: isTyping } });
    },
    [userId],
  );

  return { typingUserIds: Object.keys(typing), notifyTyping };
}
