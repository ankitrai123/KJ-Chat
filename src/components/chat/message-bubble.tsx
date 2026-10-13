"use client";

import {
  Copy,
  CornerUpLeft,
  Flag,
  Forward,
  Info,
  MoreHorizontal,
  Pencil,
  Phone,
  PhoneMissed,
  Pin,
  PinOff,
  RotateCcw,
  SmilePlus,
  Trash2,
  Video,
} from "lucide-react";
import { memo, useState } from "react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/profile/user-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { groupReactions } from "@/lib/chat/message-cache";
import { messagePreview, systemEventText } from "@/lib/chat/format";
import { canEditMessage } from "@/lib/chat/permissions";
import type { ReceiptState } from "@/lib/chat/receipts";
import { formatCallDuration, formatMessageTime } from "@/lib/chat/time";
import { cn } from "@/lib/utils";
import type { ChatMessage, Profile } from "@/types/chat";
import { AttachmentView } from "./attachment-view";
import { EmojiPicker, QUICK_REACTIONS } from "./emoji-picker";
import { MessageContent } from "./message-content";
import { ReadStatus } from "./read-status";

export interface MessageCallbacks {
  onReply: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onForward: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage, forEveryone: boolean) => void;
  onReact: (message: ChatMessage, emoji: string) => void;
  onTogglePin: (message: ChatMessage, pinned: boolean) => void;
  onJumpTo: (messageId: string) => void;
  onRetry: (message: ChatMessage) => void;
  onDiscard: (message: ChatMessage) => void;
  onInfo: (message: ChatMessage) => void;
  onReport: (message: ChatMessage) => void;
  onCallBack: (mediaType: "audio" | "video") => void;
}

const SENDER_COLORS = ["text-sky-700 dark:text-sky-300", "text-emerald-700 dark:text-emerald-300", "text-violet-700 dark:text-violet-300", "text-amber-700 dark:text-amber-300", "text-rose-700 dark:text-rose-300", "text-teal-700 dark:text-teal-300"];

function colorFor(userId: string | null) {
  if (!userId) return SENDER_COLORS[0];
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length];
}

export const SystemMessage = memo(function SystemMessage({
  message,
  nameOf,
}: {
  message: ChatMessage;
  nameOf: (userId: string | null) => string;
}) {
  return (
    <div className="my-2 flex justify-center px-4" data-message-id={message.id}>
      <span className="max-w-md rounded-full bg-card/90 px-3 py-1 text-center text-xs text-muted-foreground shadow-xs">
        {systemEventText(message.metadata, nameOf, message.sender_id)}
      </span>
    </div>
  );
});

export const CallLogMessage = memo(function CallLogMessage({
  message,
  isMine,
  onCallBack,
}: {
  message: ChatMessage;
  isMine: boolean;
  onCallBack: (mediaType: "audio" | "video") => void;
}) {
  const media = message.metadata.media_type === "video" ? "video" : "audio";
  const reason = String(message.metadata.end_reason ?? "");
  const missed = ["missed", "declined", "busy", "cancelled"].includes(reason);
  const duration = Number(message.metadata.duration_seconds ?? 0);
  const Icon = missed ? PhoneMissed : media === "video" ? Video : Phone;
  const label = messagePreview({ message_type: "call", content: null, metadata: message.metadata });
  return (
    <div className={cn("my-1 flex px-3", isMine ? "justify-end" : "justify-start")} data-message-id={message.id}>
      <button
        type="button"
        onClick={() => onCallBack(media)}
        className="flex items-center gap-3 rounded-xl bg-card px-3 py-2 text-left shadow-xs hover:bg-accent"
        aria-label={`${label}. Call back`}
      >
        <span className={cn("flex size-9 items-center justify-center rounded-full", missed ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")}>
          <Icon className="size-4" aria-hidden />
        </span>
        <span>
          <span className="block text-sm font-medium">{label}</span>
          <span className="block text-xs text-muted-foreground">
            {formatMessageTime(message.created_at)}
            {!missed && duration > 0 ? ` · ${formatCallDuration(duration)}` : ""}
          </span>
        </span>
      </button>
    </div>
  );
});

export const MessageBubble = memo(function MessageBubble({
  message,
  myUserId,
  isMine,
  sender,
  showSender,
  showAvatar,
  receipt,
  highlighted,
  isPinned,
  canPin,
  canDeleteForEveryone,
  isGroup,
  nameOf,
  isMentionable,
  callbacks,
}: {
  message: ChatMessage;
  myUserId: string;
  isMine: boolean;
  sender: Profile | null;
  showSender: boolean;
  showAvatar: boolean;
  receipt: ReceiptState | null;
  highlighted: boolean;
  isPinned: boolean;
  canPin: boolean;
  canDeleteForEveryone: boolean;
  isGroup: boolean;
  nameOf: (userId: string | null) => string;
  isMentionable: (username: string) => boolean;
  callbacks: MessageCallbacks;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const local = message.localStatus === "pending" || message.localStatus === "failed";
  const deleted = Boolean(message.deleted_at);
  const canEdit = canEditMessage(message, isMine, Date.now());
  const reactions = groupReactions(message.reactions, myUserId);
  const tone = isMine ? "out" : "in";

  const copy = async () => {
    if (!message.content) return;
    try {
      await navigator.clipboard.writeText(message.content);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy to the clipboard.");
    }
  };

  return (
    <div
      className={cn("group/msg relative flex gap-2 px-3", isMine ? "justify-end" : "justify-start", showSender ? "mt-2" : "mt-0.5")}
      data-message-id={message.id}
      onContextMenu={(e) => {
        if (local) return;
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      {isGroup && !isMine && (
        <div className="w-8 shrink-0 self-end">{showAvatar && <UserAvatar name={sender?.display_name} path={sender?.avatar_path} size="sm" />}</div>
      )}
      <div className={cn("flex max-w-[min(85%,36rem)] flex-col", isMine ? "items-end" : "items-start")}>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverAnchor asChild>
            <div
              className={cn(
                "relative rounded-2xl px-3 py-1.5 shadow-xs transition-[box-shadow,background-color]",
                isMine ? "rounded-br-md bg-bubble-out text-bubble-out-foreground" : "rounded-bl-md bg-bubble-in text-bubble-in-foreground",
                highlighted && "ring-2 ring-primary",
                message.localStatus === "failed" && "ring-1 ring-destructive/60",
              )}
            >
              {showSender && isGroup && !isMine && (
                <p className={cn("mb-0.5 text-xs font-semibold", colorFor(message.sender_id))}>{sender?.display_name ?? "Deleted account"}</p>
              )}
              {message.is_forwarded && !deleted && (
                <p className="mb-0.5 flex items-center gap-1 text-xs italic opacity-70">
                  <Forward className="size-3" aria-hidden /> Forwarded
                </p>
              )}
              {message.reply_to && !deleted && (
                <button
                  type="button"
                  onClick={() => callbacks.onJumpTo(message.reply_to!.id)}
                  className="mb-1 block w-full rounded-md border-l-4 border-primary bg-black/5 px-2 py-1 text-left text-xs dark:bg-white/5"
                  aria-label="Jump to the replied message"
                >
                  <span className="block font-semibold">{nameOf(message.reply_to.sender_id)}</span>
                  <span className="line-clamp-2 opacity-80">
                    {messagePreview({
                      message_type: message.reply_to.message_type,
                      content: message.reply_to.content,
                      deleted_at: message.reply_to.deleted_at,
                      attachment_kind: message.reply_to.attachment_kind,
                    })}
                  </span>
                </button>
              )}

              {deleted ? (
                <p className="text-sm italic opacity-70">{isMine ? "You deleted this message" : "This message was deleted"}</p>
              ) : (
                <>
                  {message.attachments.length > 0 && (
                    <div className="py-1">
                      <AttachmentView attachments={message.attachments} tone={tone} />
                    </div>
                  )}
                  {message.content && <MessageContent content={message.content} isMentionable={isGroup ? isMentionable : () => false} />}
                </>
              )}

              <div className="-mb-0.5 flex items-center justify-end gap-1 pl-6 text-[11px] opacity-70">
                {isPinned && <Pin className="size-3" aria-label="Pinned" />}
                {message.edited_at && !deleted && <span>edited</span>}
                <time dateTime={message.created_at}>{formatMessageTime(message.created_at)}</time>
                {isMine && receipt && <ReadStatus state={receipt} />}
              </div>

              {!local && (
                <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant="secondary"
                      className={cn(
                        "absolute -top-3 size-7 rounded-full opacity-0 shadow-sm transition-opacity group-hover/msg:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-60",
                        isMine ? "-left-3" : "-right-3",
                      )}
                      aria-label="Message options"
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align={isMine ? "end" : "start"} className="w-[17rem]">
                    {!deleted && (
                      <>
                        <div className="flex items-center justify-between gap-1 px-1 py-1" role="group" aria-label="Quick reactions">
                          {QUICK_REACTIONS.map((emoji) => (
                            <DropdownMenuItem
                              key={emoji}
                              className="justify-center p-1 text-lg"
                              onSelect={() => callbacks.onReact(message, emoji)}
                              aria-label={`React with ${emoji}`}
                            >
                              {emoji}
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuItem className="justify-center p-1" onSelect={() => setPickerOpen(true)} aria-label="More reactions">
                            <SmilePlus />
                          </DropdownMenuItem>
                        </div>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => callbacks.onReply(message)}>
                          <CornerUpLeft /> Reply
                        </DropdownMenuItem>
                        {message.content && (
                          <DropdownMenuItem onSelect={() => void copy()}>
                            <Copy /> Copy text
                          </DropdownMenuItem>
                        )}
                        {canEdit && (
                          <DropdownMenuItem onSelect={() => callbacks.onEdit(message)}>
                            <Pencil /> Edit
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={() => callbacks.onForward(message)}>
                          <Forward /> Forward
                        </DropdownMenuItem>
                        {canPin && (
                          <DropdownMenuItem onSelect={() => callbacks.onTogglePin(message, !isPinned)}>
                            {isPinned ? <PinOff /> : <Pin />} {isPinned ? "Unpin" : "Pin"}
                          </DropdownMenuItem>
                        )}
                        {isMine && (
                          <DropdownMenuItem onSelect={() => callbacks.onInfo(message)}>
                            <Info /> Message info
                          </DropdownMenuItem>
                        )}
                        {!isMine && message.sender_id && (
                          <DropdownMenuItem onSelect={() => callbacks.onReport(message)}>
                            <Flag /> Report
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuItem variant="destructive" onSelect={() => callbacks.onDelete(message, false)}>
                      <Trash2 /> Delete for me
                    </DropdownMenuItem>
                    {canDeleteForEveryone && !deleted && (
                      <DropdownMenuItem variant="destructive" onSelect={() => callbacks.onDelete(message, true)}>
                        <Trash2 /> Delete for everyone
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </PopoverAnchor>
          <PopoverContent className="w-auto p-0" align={isMine ? "end" : "start"}>
            <EmojiPicker
              onSelect={(emoji) => {
                setPickerOpen(false);
                callbacks.onReact(message, emoji);
              }}
            />
          </PopoverContent>
        </Popover>

        {reactions.length > 0 && (
          <div className={cn("-mt-1 flex flex-wrap gap-1", isMine ? "justify-end pr-2" : "pl-2")}>
            {reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => callbacks.onReact(message, r.emoji)}
                className={cn(
                  "flex items-center gap-1 rounded-full border bg-card px-1.5 py-0.5 text-xs shadow-xs hover:bg-accent",
                  r.mine && "border-primary bg-primary/10",
                )}
                aria-pressed={r.mine}
                aria-label={`${r.emoji} ${r.count}: ${r.userIds.map((id) => nameOf(id)).join(", ")}`}
                title={r.userIds.map((id) => nameOf(id)).join(", ")}
              >
                <span>{r.emoji}</span>
                {r.count > 1 && <span className="font-medium">{r.count}</span>}
              </button>
            ))}
          </div>
        )}

        {message.localStatus === "failed" && (
          <div className="mt-1 flex items-center gap-2 text-xs text-destructive" role="alert">
            <span>{message.localError ?? "Not sent."}</span>
            <button type="button" onClick={() => callbacks.onRetry(message)} className="inline-flex items-center gap-1 font-semibold underline">
              <RotateCcw className="size-3" aria-hidden /> Retry
            </button>
            <button type="button" onClick={() => callbacks.onDiscard(message)} className="font-semibold underline">
              Discard
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
