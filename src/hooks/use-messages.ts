"use client";

import { type InfiniteData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useSession } from "@/components/providers/session-provider";
import { apiFetch } from "@/lib/api-client";
import {
  addReaction,
  flattenMessages,
  findMessage,
  type MessagePage,
  type MessagePages,
  removeMessage,
  removeReaction,
  updateMessage,
  upsertMessages,
} from "@/lib/chat/message-cache";
import { fetchMessagePage, fetchMessagesByIds } from "@/lib/chat/message-fetcher";
import { EMPTY_OUTBOX, outbox } from "@/lib/chat/outbox";
import { AppError, fromDatabaseError, toUserMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AttachmentInput } from "@/lib/validation/chat";
import { type ChatMessage, normalizeMessage, type PendingPayload } from "@/types/chat";
import type { MessageDetailsRow } from "@/types/database";

export function useMessages(conversationId: string) {
  const query = useInfiniteQuery<MessagePage, Error, InfiniteData<MessagePage, string | null>, readonly string[], string | null>({
    queryKey: queryKeys.messages(conversationId),
    queryFn: ({ pageParam }) => fetchMessagePage(conversationId, pageParam),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 10_000,
  });

  const pending = useSyncExternalStore(
    outbox.subscribe,
    () => outbox.get(conversationId),
    () => EMPTY_OUTBOX,
  );

  const messages = useMemo(() => {
    const server = flattenMessages(query.data as MessagePages | undefined);
    const confirmed = new Set(server.map((m) => m.client_id).filter(Boolean));
    // Unconfirmed sends render after all confirmed history, in the order they were written.
    return [...server, ...pending.filter((m) => !confirmed.has(m.client_id))];
  }, [query.data, pending]);

  return { ...query, messages };
}

interface SendOptions {
  content?: string;
  replyTo?: ChatMessage | null;
  attachments?: AttachmentInput[];
  forwardFromMessageId?: string;
}

/** All message mutations for one conversation, with optimistic updates and rollback. */
export function useMessageActions(conversationId: string) {
  const queryClient = useQueryClient();
  const { userId } = useSession();
  const key = queryKeys.messages(conversationId);

  const deliver = useCallback(
    async (clientId: string, targetConversationId: string, payload: PendingPayload) => {
      outbox.update(clientId, (m) => ({ ...m, localStatus: "pending", localError: undefined, localRetryable: undefined }));
      try {
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          throw new AppError("network", "You're offline. The message will be sent when you reconnect.");
        }
        const response = await apiFetch<{ message: MessageDetailsRow }>("/api/messages", {
          method: "POST",
          body: { conversationId: targetConversationId, clientId, ...payload },
        });
        const message = normalizeMessage(response.message);
        queryClient.setQueryData<MessagePages>(queryKeys.messages(targetConversationId), (data) =>
          data ? upsertMessages(data, [message]) : data,
        );
        outbox.remove(clientId);
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
        return message;
      } catch (error) {
        const permanent = error instanceof AppError && ["forbidden", "not_found", "invalid"].includes(error.kind);
        outbox.update(clientId, (m) => ({
          ...m,
          localStatus: "failed",
          localError: toUserMessage(error),
          // Permanent failures (e.g. blocked) shouldn't auto-retry on reconnect.
          localRetryable: !permanent,
        }));
        if (permanent) toast.error(toUserMessage(error));
        throw error;
      }
    },
    [queryClient],
  );

  const send = useCallback(
    async ({ content, replyTo, attachments = [], forwardFromMessageId }: SendOptions, target = conversationId) => {
      const clientId = crypto.randomUUID();
      const now = new Date().toISOString();
      const trimmed = content?.trim() ? content : undefined;
      const payload: PendingPayload = {
        content: trimmed,
        replyToMessageId: replyTo?.id,
        attachments,
        forwardFromMessageId,
      };
      const firstKind = attachments[0]?.kind;
      outbox.add({
        id: clientId,
        client_id: clientId,
        conversation_id: target,
        sender_id: userId,
        message_type: firstKind ?? "text",
        content: trimmed ?? null,
        metadata: {},
        reply_to_message_id: replyTo?.id ?? null,
        is_forwarded: Boolean(forwardFromMessageId),
        created_at: now,
        updated_at: now,
        edited_at: null,
        deleted_at: null,
        attachments: attachments.map((a) => ({
          id: a.path,
          storage_path: a.path,
          file_name: a.fileName,
          mime_type: a.mimeType,
          file_size: a.size,
          kind: a.kind,
          width: a.width ?? null,
          height: a.height ?? null,
          duration_ms: a.durationMs ?? null,
          waveform: a.waveform ?? null,
        })),
        reactions: [],
        reply_to: replyTo
          ? {
              id: replyTo.id,
              sender_id: replyTo.sender_id,
              message_type: replyTo.message_type,
              content: replyTo.content,
              deleted_at: replyTo.deleted_at,
              attachment_kind: replyTo.attachments[0]?.kind ?? null,
            }
          : null,
        localStatus: "pending",
        localPayload: payload,
      });
      return deliver(clientId, target, payload).catch(() => null);
    },
    [conversationId, deliver, userId],
  );

  const retry = useCallback(
    (clientId: string) => {
      const message = outbox.find(clientId);
      if (!message?.localPayload) return;
      void deliver(clientId, message.conversation_id, message.localPayload).catch(() => null);
    },
    [deliver],
  );

  const discard = useCallback((clientId: string) => outbox.remove(clientId), []);

  const edit = useCallback(
    async (messageId: string, content: string) => {
      const previous = findMessage(queryClient.getQueryData<MessagePages>(key), messageId);
      queryClient.setQueryData<MessagePages>(key, (data) =>
        updateMessage(data, messageId, (m) => ({ ...m, content, edited_at: new Date().toISOString() })),
      );
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.rpc("edit_message", { p_message_id: messageId, p_content: content });
      if (error) {
        if (previous) queryClient.setQueryData<MessagePages>(key, (data) => updateMessage(data, messageId, () => previous));
        toast.error(fromDatabaseError(error, "Could not edit the message.").message);
        return false;
      }
      const [fresh] = await fetchMessagesByIds([messageId]).catch(() => []);
      if (fresh) queryClient.setQueryData<MessagePages>(key, (data) => upsertMessages(data, [fresh]));
      return true;
    },
    [key, queryClient],
  );

  const remove = useCallback(
    async (messageId: string, forEveryone: boolean) => {
      const previous = findMessage(queryClient.getQueryData<MessagePages>(key), messageId);
      try {
        if (forEveryone) {
          queryClient.setQueryData<MessagePages>(key, (data) =>
            updateMessage(data, messageId, (m) => ({
              ...m,
              content: null,
              attachments: [],
              reactions: [],
              deleted_at: new Date().toISOString(),
            })),
          );
          // Through the server so storage objects are removed immediately.
          await apiFetch(`/api/messages/${messageId}`, { method: "DELETE" });
        } else {
          queryClient.setQueryData<MessagePages>(key, (data) => removeMessage(data, messageId));
          const supabase = getSupabaseBrowserClient();
          const { error } = await supabase.rpc("delete_message", { p_message_id: messageId, p_for_everyone: false });
          if (error) throw fromDatabaseError(error, "Could not delete the message.");
        }
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      } catch (error) {
        if (previous) queryClient.setQueryData<MessagePages>(key, (data) => upsertMessages(data, [previous]));
        toast.error(toUserMessage(error));
      }
    },
    [key, queryClient],
  );

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      const message = findMessage(queryClient.getQueryData<MessagePages>(key), messageId);
      const existing = message?.reactions.find((r) => r.user_id === userId && r.emoji === emoji);
      queryClient.setQueryData<MessagePages>(key, (data) =>
        existing
          ? removeReaction(data, messageId, { user_id: userId, emoji })
          : addReaction(data, messageId, { id: `local-${emoji}`, user_id: userId, emoji, created_at: new Date().toISOString() }),
      );
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.rpc("toggle_reaction", { p_message_id: messageId, p_emoji: emoji });
      if (error) {
        // Roll back by re-reading the message.
        const [fresh] = await fetchMessagesByIds([messageId]).catch(() => []);
        if (fresh) queryClient.setQueryData<MessagePages>(key, (data) => upsertMessages(data, [fresh]));
        toast.error(fromDatabaseError(error, "Could not update the reaction.").message);
        return;
      }
      // Replace the placeholder id with the server's so later realtime events match.
      const [fresh] = await fetchMessagesByIds([messageId]).catch(() => []);
      if (fresh) queryClient.setQueryData<MessagePages>(key, (data) => upsertMessages(data, [fresh]));
    },
    [key, queryClient, userId],
  );

  const setPinned = useCallback(
    async (messageId: string, pinned: boolean) => {
      const supabase = getSupabaseBrowserClient();
      const { error } = pinned
        ? await supabase.rpc("pin_message", { p_message_id: messageId })
        : await supabase.rpc("unpin_message", { p_message_id: messageId });
      if (error) {
        toast.error(fromDatabaseError(error).message);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.pins(conversationId) });
      toast.success(pinned ? "Message pinned" : "Message unpinned");
    },
    [conversationId, queryClient],
  );

  return { send, retry, discard, edit, remove, toggleReaction, setPinned };
}

/** Retries network-failed sends automatically when connectivity returns. */
export function retryFailedOnReconnect(retry: (clientId: string) => void) {
  for (const message of outbox.all()) {
    if (message.localStatus === "failed" && message.client_id && message.localRetryable !== false) retry(message.client_id);
  }
}

export function useReactionRemovedHandler(conversationId: string) {
  const queryClient = useQueryClient();
  return useCallback(
    (payload: { id?: string; message_id?: string }) => {
      if (!payload.message_id) return;
      queryClient.setQueryData<MessagePages>(queryKeys.messages(conversationId), (data) =>
        removeReaction(data, payload.message_id!, { id: payload.id }),
      );
    },
    [conversationId, queryClient],
  );
}
