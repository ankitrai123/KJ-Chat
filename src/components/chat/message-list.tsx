"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown } from "lucide-react";
import { forwardRef, Fragment, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton, Spinner } from "@/components/ui/misc";
import { receiptState } from "@/lib/chat/receipts";
import { compareTimestamps, formatDaySeparator, isDifferentDay } from "@/lib/chat/time";
import { queryKeys } from "@/lib/query-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ChatMessage, ConversationSummary, MemberWithProfile, Profile } from "@/types/chat";
import { CallLogMessage, type MessageCallbacks, MessageBubble, SystemMessage } from "./message-bubble";

export interface MessageListHandle {
  jumpTo: (messageId: string) => void;
  scrollToBottom: () => void;
}

const GROUP_WINDOW_MS = 5 * 60 * 1000;

export const MessageList = forwardRef<
  MessageListHandle,
  {
    conversation: ConversationSummary;
    messages: ChatMessage[];
    members: MemberWithProfile[];
    myUserId: string;
    showReadReceipts: boolean;
    pinnedIds: ReadonlySet<string>;
    isPending: boolean;
    isError: boolean;
    hasMore: boolean;
    isFetchingMore: boolean;
    fetchMore: () => Promise<unknown>;
    retry: () => void;
    callbacks: MessageCallbacks;
  }
>(function MessageList(
  { conversation, messages, members, myUserId, showReadReceipts, pinnedIds, isPending, isError, hasMore, isFetchingMore, fetchMore, retry, callbacks },
  ref,
) {
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [pendingJump, setPendingJump] = useState<{ id: string; attempts: number } | null>(null);
  // Captured once so the "unread" divider stays put while the conversation is being read.
  const [initialLastReadAt] = useState(conversation.last_read_at);
  const lastMarkedRef = useRef<string | null>(null);

  const isGroup = conversation.type === "group";
  const isAdmin = conversation.my_role === "owner" || conversation.my_role === "admin";

  const profiles = useMemo(() => {
    const map = new Map<string, Profile>();
    for (const m of members) if (m.profile) map.set(m.user_id, m.profile);
    return map;
  }, [members]);

  const nameOf = useCallback(
    (userId: string | null) => {
      if (!userId) return "Deleted account";
      if (userId === myUserId) return "You";
      return profiles.get(userId)?.display_name ?? (conversation.peer?.id === userId ? conversation.peer.display_name : "Former member");
    },
    [conversation.peer, myUserId, profiles],
  );

  const usernames = useMemo(() => new Set(members.map((m) => m.profile?.username).filter(Boolean)), [members]);
  const isMentionable = useCallback((username: string) => usernames.has(username), [usernames]);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const flash = useCallback((id: string) => {
    setHighlight(id);
    setTimeout(() => setHighlight((current) => (current === id ? null : current)), 2200);
  }, []);

  const jumpTo = useCallback(
    (messageId: string) => {
      const el = scrollRef.current?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        flash(messageId);
      } else {
        setPendingJump({ id: messageId, attempts: 0 });
      }
    },
    [flash],
  );

  useImperativeHandle(ref, () => ({ jumpTo, scrollToBottom }), [jumpTo, scrollToBottom]);

  // Older history: keep paging back until the jump target is loaded (bounded).
  useEffect(() => {
    if (!pendingJump) return;
    const el = scrollRef.current?.querySelector(`[data-message-id="${CSS.escape(pendingJump.id)}"]`);
    if (el) {
      const id = pendingJump.id;
      const timer = setTimeout(() => {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        flash(id);
        setPendingJump(null);
      }, 50);
      return () => clearTimeout(timer);
    }
    if (!hasMore || pendingJump.attempts >= 30) {
      const timer = setTimeout(() => setPendingJump(null), 0);
      return () => clearTimeout(timer);
    }
    if (isFetchingMore) return;
    let cancelled = false;
    void fetchMore().then(() => {
      if (!cancelled) setPendingJump((p) => (p ? { ...p, attempts: p.attempts + 1 } : p));
    });
    return () => {
      cancelled = true;
    };
  }, [fetchMore, flash, hasMore, isFetchingMore, messages.length, pendingJump]);

  // Infinite scroll: load older messages when the top sentinel approaches the viewport.
  useEffect(() => {
    const root = scrollRef.current;
    const target = topSentinelRef.current;
    if (!root || !target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !isFetchingMore) void fetchMore();
      },
      { root, rootMargin: "600px 0px 0px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [fetchMore, hasMore, isFetchingMore]);

  // Keep my own new messages in view.
  const last = messages[messages.length - 1];
  useEffect(() => {
    if (last?.localStatus === "pending" && last.sender_id === myUserId) scrollToBottom();
  }, [last?.id, last?.localStatus, last?.sender_id, myUserId, scrollToBottom]);

  // Mark as read when the newest message is visible and the window is focused.
  const latestConfirmed = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].localStatus !== "pending" && messages[i].localStatus !== "failed") return messages[i];
    }
    return null;
  }, [messages]);

  useEffect(() => {
    if (!atBottom || !latestConfirmed) return;
    const markRead = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      if (lastMarkedRef.current === latestConfirmed.id) return;
      lastMarkedRef.current = latestConfirmed.id;
      const supabase = getSupabaseBrowserClient();
      void supabase.rpc("mark_conversation_read", { p_conversation_id: conversation.id, p_message_id: latestConfirmed.id });
      queryClient.setQueryData<ConversationSummary[]>(queryKeys.conversations, (list) =>
        list?.map((c) => (c.id === conversation.id ? { ...c, unread_count: 0, mention_count: 0, last_read_at: latestConfirmed.created_at } : c)),
      );
    };
    const timer = setTimeout(markRead, 400);
    window.addEventListener("focus", markRead);
    document.addEventListener("visibilitychange", markRead);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", markRead);
      document.removeEventListener("visibilitychange", markRead);
    };
  }, [atBottom, conversation.id, latestConfirmed, queryClient]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    // flex-col-reverse: scrollTop is 0 at the bottom and negative when scrolled up.
    const next = Math.abs(el.scrollTop) < 120;
    if (next !== atBottom) setAtBottom(next);
  };

  const firstUnreadId = useMemo(() => {
    if (!initialLastReadAt) return null;
    return (
      messages.find(
        (m) =>
          m.sender_id !== myUserId &&
          m.message_type !== "system" &&
          !m.localStatus?.startsWith("p") &&
          compareTimestamps(m.created_at, initialLastReadAt) > 0,
      )?.id ?? null
    );
  }, [initialLastReadAt, messages, myUserId]);

  const unreadBelow = !atBottom ? conversation.unread_count : 0;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scrollbar-thin flex h-full flex-col-reverse overflow-y-auto overscroll-contain"
        role="log"
        aria-label="Messages"
        aria-busy={isPending}
      >
        <div className="flex min-h-full flex-col justify-end py-3">
          <div ref={topSentinelRef} aria-hidden className="h-px" />
          {isFetchingMore && (
            <div className="flex justify-center py-3">
              <Spinner label="Loading older messages" />
            </div>
          )}
          {!hasMore && !isPending && messages.length > 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">This is the beginning of the conversation.</p>
          )}
          {isPending && (
            <div className="grid gap-3 px-4" aria-hidden>
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className={i % 2 ? "ml-auto h-10 w-1/2 rounded-2xl" : "h-12 w-2/3 rounded-2xl"} />
              ))}
            </div>
          )}
          {isError && (
            <div className="grid justify-items-center gap-2 p-6 text-center" role="alert">
              <p className="text-sm text-muted-foreground">Couldn&apos;t load messages.</p>
              <Button size="sm" variant="outline" onClick={retry}>
                Try again
              </Button>
            </div>
          )}
          {!isPending && !isError && messages.length === 0 && (
            <div className="m-auto max-w-xs rounded-xl bg-card/80 p-4 text-center text-sm text-muted-foreground shadow-xs">
              No messages yet. Say hello 👋
            </div>
          )}

          {messages.map((message, index) => {
            const prev = messages[index - 1];
            const newDay = !prev || isDifferentDay(prev.created_at, message.created_at);
            const sameRun =
              prev &&
              !newDay &&
              prev.sender_id === message.sender_id &&
              prev.message_type !== "system" &&
              prev.message_type !== "call" &&
              Date.parse(message.created_at) - Date.parse(prev.created_at) < GROUP_WINDOW_MS;
            const next = messages[index + 1];
            const lastInRun =
              !next || next.sender_id !== message.sender_id || isDifferentDay(message.created_at, next.created_at) || next.message_type === "system";
            const isMine = message.sender_id === myUserId;

            let node: React.ReactNode;
            if (message.message_type === "system") {
              node = <SystemMessage message={message} nameOf={nameOf} />;
            } else if (message.message_type === "call") {
              node = <CallLogMessage message={message} isMine={isMine} onCallBack={callbacks.onCallBack} />;
            } else {
              node = (
                <MessageBubble
                  message={message}
                  myUserId={myUserId}
                  isMine={isMine}
                  sender={message.sender_id ? (profiles.get(message.sender_id) ?? null) : null}
                  showSender={!sameRun}
                  showAvatar={lastInRun}
                  receipt={isMine ? receiptState(message, members, myUserId, { showReadReceipts }) : null}
                  highlighted={highlight === message.id}
                  isPinned={pinnedIds.has(message.id)}
                  canPin={!isGroup || isAdmin}
                  canDeleteForEveryone={isMine || (isGroup && isAdmin)}
                  isGroup={isGroup}
                  nameOf={nameOf}
                  isMentionable={isMentionable}
                  callbacks={callbacks}
                />
              );
            }

            return (
              <Fragment key={message.client_id && message.localStatus !== "sent" ? message.client_id : message.id}>
                {newDay && (
                  <div className="sticky top-1 z-10 my-2 flex justify-center">
                    <span className="rounded-full bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-xs">
                      {formatDaySeparator(message.created_at)}
                    </span>
                  </div>
                )}
                {message.id === firstUnreadId && (
                  <div className="my-2 flex items-center gap-3 px-4" role="separator" aria-label="Unread messages">
                    <span className="h-px flex-1 bg-primary/40" />
                    <span className="text-xs font-semibold text-primary">Unread messages</span>
                    <span className="h-px flex-1 bg-primary/40" />
                  </div>
                )}
                {node}
              </Fragment>
            );
          })}
        </div>
      </div>
      {!atBottom && (
        <Button
          size="icon"
          variant="secondary"
          className="absolute right-4 bottom-4 rounded-full shadow-md"
          onClick={scrollToBottom}
          aria-label={unreadBelow ? `${unreadBelow} new messages. Scroll to latest` : "Scroll to latest message"}
        >
          <ArrowDown />
          {unreadBelow > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs text-primary-foreground">
              {unreadBelow}
            </span>
          )}
        </Button>
      )}
    </div>
  );
});
