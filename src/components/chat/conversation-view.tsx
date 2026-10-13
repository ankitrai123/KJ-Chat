"use client";

import { Phone, Upload, Video } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCalls } from "@/components/calls/call-provider";
import { useSession } from "@/components/providers/session-provider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/misc";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useBlockActions, useIsBlocked } from "@/hooks/use-blocks";
import { useConversationChannel } from "@/hooks/use-conversation-channel";
import { openDirectConversation, useClearConversation, useConversation, useMembers, useUpdatePreferences } from "@/hooks/use-conversations";
import { useGroupActions } from "@/hooks/use-group-actions";
import { useMediaQuery } from "@/hooks/use-media-query";
import { retryFailedOnReconnect, useMessageActions, useMessages } from "@/hooks/use-messages";
import { useUploads } from "@/hooks/use-uploads";
import { realtimeBus } from "@/lib/realtime/bus";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/errors";
import type { ChatMessage } from "@/types/chat";
import { conversationTitle } from "@/types/chat";
import { ChatHeader } from "./chat-header";
import { Composer } from "./composer";
import { ConversationDetails } from "./conversation-details";
import { ForwardDialog } from "./forward-dialog";
import { MessageInfoDialog } from "./message-info-dialog";
import type { MessageCallbacks } from "./message-bubble";
import { MessageList, type MessageListHandle } from "./message-list";
import { PinnedBar, usePinnedMessages } from "./pinned-bar";
import { ReportDialog, type ReportTarget } from "./report-dialog";
import { SearchPanel } from "./search-panel";

type Panel = "details" | "search" | null;

export function ConversationView({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { userId, settings } = useSession();
  const { conversation, isPending: conversationsPending, isError: conversationsError, refetch: refetchConversations } = useConversation(conversationId);
  const { data: members = [] } = useMembers(conversation ? conversationId : null);
  const messagesQuery = useMessages(conversationId);
  const actions = useMessageActions(conversationId);
  const uploads = useUploads(conversationId);
  const channel = useConversationChannel(conversationId, userId);
  const calls = useCalls();
  const { data: pinned = [] } = usePinnedMessages(conversationId);
  const updatePreferences = useUpdatePreferences();
  const clearConversation = useClearConversation();
  const groupActions = useGroupActions(conversationId);
  const blockActions = useBlockActions();
  const isDesktop = useMediaQuery("(min-width: 1280px)");

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const [infoFor, setInfoFor] = useState<ChatMessage | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [dragging, setDragging] = useState(false);
  const listRef = useRef<MessageListHandle>(null);
  const dragDepth = useRef(0);

  const peerId = conversation?.type === "direct" ? (conversation.peer?.id ?? null) : null;
  const isBlocked = useIsBlocked(peerId);
  const title = conversation ? conversationTitle(conversation) : "";
  const pinnedIds = useMemo(() => new Set(pinned.map((m) => m.id)), [pinned]);

  const peer = conversation?.peer ?? null;
  const nameOf = useCallback(
    (id: string | null) => {
      if (!id) return "Deleted account";
      if (id === userId) return "You";
      return members.find((m) => m.user_id === id)?.profile?.display_name ?? (peer?.id === id ? peer.display_name : "Former member");
    },
    [peer, members, userId],
  );

  // Deep links: ?message=<id> (search results, notifications) and ?call=<id> (push notifications).
  const targetMessage = searchParams.get("message");
  const targetCall = searchParams.get("call");
  const handledTarget = useRef<string | null>(null);
  useEffect(() => {
    if (!targetMessage || messagesQuery.isPending || handledTarget.current === targetMessage) return;
    handledTarget.current = targetMessage;
    listRef.current?.jumpTo(targetMessage);
  }, [messagesQuery.isPending, targetMessage]);
  useEffect(() => {
    if (targetCall) calls.showIncomingIfRinging(targetCall);
  }, [calls, targetCall]);

  // Auto-retry network-failed sends when the connection comes back.
  useEffect(() => {
    const retry = () => retryFailedOnReconnect(actions.retry);
    const off = realtimeBus.on("reconnected", retry);
    window.addEventListener("online", retry);
    return () => {
      off();
      window.removeEventListener("online", retry);
    };
  }, [actions.retry]);

  // Removed from the group or the group was deleted while viewing it.
  useEffect(() => {
    const leave = (payload: { conversation_id: string }, message: string) => {
      if (payload.conversation_id !== conversationId) return;
      toast.info(message);
      router.replace("/chats");
    };
    const offRemoved = realtimeBus.on("membership:removed", (p) => leave(p, "You were removed from this group."));
    const offDeleted = realtimeBus.on("conversation:deleted", (p) => leave(p, "This group was deleted."));
    return () => {
      offRemoved();
      offDeleted();
    };
  }, [conversationId, router]);

  const callbacks = useMemo<MessageCallbacks>(
    () => ({
      onReply: (m) => {
        setEditing(null);
        setReplyTo(m);
      },
      onEdit: (m) => {
        setReplyTo(null);
        setEditing(m);
      },
      onForward: setForwarding,
      onDelete: (m, forEveryone) =>
        setConfirm({
          title: forEveryone ? "Delete for everyone?" : "Delete for you?",
          description: forEveryone
            ? "The message and its files will be removed for everyone in this chat."
            : "The message will be removed from this device and your other devices. Others will still see it.",
          confirmLabel: "Delete",
          destructive: true,
          onConfirm: () => actions.remove(m.id, forEveryone),
        }),
      onReact: (m, emoji) => void actions.toggleReaction(m.id, emoji),
      onTogglePin: (m, pin) => void actions.setPinned(m.id, pin),
      onJumpTo: (id) => listRef.current?.jumpTo(id),
      onRetry: (m) => m.client_id && actions.retry(m.client_id),
      onDiscard: (m) => m.client_id && actions.discard(m.client_id),
      onInfo: setInfoFor,
      onReport: (m) => setReportTarget({ userId: m.sender_id, messageId: m.id, label: "message" }),
      onCallBack: (media) => void calls.startCall(conversationId, media),
    }),
    [actions, calls, conversationId],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length && !editing) void uploads.addFiles(files);
  };

  if (conversationsPending) {
    return (
      <div className="flex h-full flex-col" aria-busy="true">
        <div className="flex items-center gap-3 border-b p-3">
          <Skeleton className="size-10 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex-1" />
      </div>
    );
  }

  if (conversationsError && !conversation) {
    return (
      <div className="m-auto grid justify-items-center gap-3 p-6 text-center" role="alert">
        <p className="text-muted-foreground">Couldn&apos;t load this conversation.</p>
        <Button variant="outline" onClick={() => void refetchConversations()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="m-auto grid max-w-sm justify-items-center gap-3 p-6 text-center">
        <h1 className="text-lg font-semibold">Conversation unavailable</h1>
        <p className="text-sm text-muted-foreground">It may have been deleted, or you&apos;re no longer a member.</p>
        <Button asChild variant="outline">
          <Link href="/chats">Back to chats</Link>
        </Button>
      </div>
    );
  }

  const peerDeleted = conversation.type === "direct" && !conversation.peer;
  const activeCall = conversation.active_call;
  const typingNames = channel.typingUserIds.map((id) => nameOf(id).split(" ")[0]);

  const details = (
    <ConversationDetails
      conversation={conversation}
      members={members}
      myUserId={userId}
      isBlocked={isBlocked}
      onBlockToggle={() => peerId && (isBlocked ? blockActions.unblock.mutate(peerId) : blockActions.block.mutate(peerId))}
      onReport={() => setReportTarget({ userId: peerId, messageId: null, label: title })}
      onLeave={() =>
        setConfirm({
          title: `Leave "${title}"?`,
          description: "You'll stop receiving messages and lose access to the group's history.",
          confirmLabel: "Leave",
          destructive: true,
          onConfirm: async () => {
            if (await groupActions.leave()) router.replace("/chats");
          },
        })
      }
      onDelete={() =>
        setConfirm({
          title: `Delete "${title}" for everyone?`,
          description: "All messages and files in this group will be permanently deleted. This cannot be undone.",
          confirmLabel: "Delete group",
          destructive: true,
          onConfirm: async () => {
            if (await groupActions.deleteGroup()) router.replace("/chats");
          },
        })
      }
      onMessage={async (otherId) => {
        try {
          router.push(`/chats/${await openDirectConversation(otherId)}`);
        } catch (e) {
          toast.error(toUserMessage(e));
        }
      }}
    />
  );
  const search = <SearchPanel conversationId={conversationId} nameOf={nameOf} onSelect={(id) => listRef.current?.jumpTo(id)} />;

  return (
    <div className="flex h-full min-h-0 flex-1">
      <section
        className="relative flex min-w-0 flex-1 flex-col"
        aria-label={`Conversation with ${title}`}
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={onDrop}
      >
        <ChatHeader
          conversation={conversation}
          members={members}
          typingNames={typingNames}
          isBlocked={isBlocked}
          callsDisabled={isBlocked || peerDeleted || calls.busy}
          actions={{
            onOpenDetails: () => setPanel((p) => (p === "details" ? null : "details")),
            onOpenSearch: () => setPanel((p) => (p === "search" ? null : "search")),
            onCall: (media) => void calls.startCall(conversationId, media),
            onMute: (until) => updatePreferences.mutate({ conversationId, patch: { muted_until: until } }),
            onArchive: (archived) => updatePreferences.mutate({ conversationId, patch: { archived_at: archived ? new Date().toISOString() : null } }),
            onClear: () =>
              setConfirm({
                title: conversation.type === "direct" ? "Delete this chat?" : "Clear this chat?",
                description: "Messages are removed for you only. Others in the chat keep their copy.",
                confirmLabel: conversation.type === "direct" ? "Delete chat" : "Clear chat",
                destructive: true,
                onConfirm: async () => {
                  await clearConversation.mutateAsync(conversationId);
                  if (conversation.type === "direct") router.replace("/chats");
                },
              }),
            onBlockToggle: () => peerId && (isBlocked ? blockActions.unblock.mutate(peerId) : blockActions.block.mutate(peerId)),
            onReport: () => setReportTarget({ userId: peerId, messageId: null, label: title }),
            onLeave: () => setPanel("details"),
          }}
        />
        <PinnedBar conversationId={conversationId} onJump={(id) => listRef.current?.jumpTo(id)} />
        {activeCall && calls.activeCallId !== activeCall.id && (
          <div className="flex items-center gap-3 border-b bg-success/10 px-4 py-2 text-sm" role="status">
            {activeCall.media_type === "video" ? <Video className="size-4" aria-hidden /> : <Phone className="size-4" aria-hidden />}
            <span className="flex-1">{activeCall.status === "ringing" ? "Ringing…" : "A call is in progress"}</span>
            <Button size="sm" onClick={() => void calls.joinCall(activeCall.id, conversationId)} disabled={calls.busy}>
              Join
            </Button>
          </div>
        )}

        <MessageList
          ref={listRef}
          conversation={conversation}
          messages={messagesQuery.messages}
          members={members}
          myUserId={userId}
          showReadReceipts={settings.read_receipts_enabled}
          pinnedIds={pinnedIds}
          isPending={messagesQuery.isPending}
          isError={messagesQuery.isError}
          hasMore={Boolean(messagesQuery.hasNextPage)}
          isFetchingMore={messagesQuery.isFetchingNextPage}
          fetchMore={messagesQuery.fetchNextPage}
          retry={() => void messagesQuery.refetch()}
          callbacks={callbacks}
        />

        {peerDeleted ? (
          <p className="border-t bg-background p-4 text-center text-sm text-muted-foreground pb-safe">This account has been deleted. You can&apos;t reply.</p>
        ) : isBlocked ? (
          <div className="flex items-center justify-center gap-3 border-t bg-background p-4 text-sm pb-safe">
            <span className="text-muted-foreground">You blocked {title}.</span>
            <Button size="sm" variant="outline" onClick={() => peerId && blockActions.unblock.mutate(peerId)}>
              Unblock
            </Button>
          </div>
        ) : (
          <Composer
            key={editing?.id ?? "compose"}
            conversationId={conversationId}
            isGroup={conversation.type === "group"}
            members={members}
            myUserId={userId}
            uploads={uploads}
            replyTo={replyTo}
            editing={editing}
            nameOf={nameOf}
            onCancelReply={() => setReplyTo(null)}
            onCancelEdit={() => setEditing(null)}
            onSend={(input) => actions.send({ ...input, replyTo })}
            onEdit={(m, content) => actions.edit(m.id, content)}
            onTyping={channel.notifyTyping}
          />
        )}

        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-primary/10 backdrop-blur-[1px]">
            <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-primary bg-background/90 px-10 py-8">
              <Upload className="size-8 text-primary" aria-hidden />
              <p className="font-medium">Drop files to send</p>
            </div>
          </div>
        )}
      </section>

      {panel && isDesktop && (
        <aside className="w-[360px] shrink-0 overflow-y-auto border-l bg-background" aria-label={panel === "details" ? "Details" : "Search"}>
          {panel === "details" ? details : search}
        </aside>
      )}
      {!isDesktop && (
        <Sheet open={Boolean(panel)} onOpenChange={(open) => !open && setPanel(null)}>
          <SheetContent side="right" className="overflow-y-auto p-0">
            <SheetHeader className="border-b">
              <SheetTitle>{panel === "search" ? "Search" : conversation.type === "group" ? "Group info" : "Contact info"}</SheetTitle>
            </SheetHeader>
            {panel === "search" ? search : details}
          </SheetContent>
        </Sheet>
      )}

      <ForwardDialog message={forwarding} onClose={() => setForwarding(null)} />
      <MessageInfoDialog
        message={infoFor}
        members={members}
        myUserId={userId}
        showReadReceipts={settings.read_receipts_enabled}
        onClose={() => setInfoFor(null)}
      />
      <ReportDialog target={reportTarget} onClose={() => setReportTarget(null)} />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
