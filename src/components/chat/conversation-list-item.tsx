"use client";

import { Archive, ArchiveRestore, BellOff, MoreVertical, Phone, Pin, PinOff, Video } from "lucide-react";
import Link from "next/link";
import { memo } from "react";
import { useIsOnline } from "@/components/providers/presence-provider";
import { UserAvatar } from "@/components/profile/user-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isMuted, formatUnread } from "@/lib/chat/conversations";
import { messagePreview } from "@/lib/chat/format";
import { formatListTimestamp } from "@/lib/chat/time";
import { cn } from "@/lib/utils";
import { type ConversationSummary, conversationTitle } from "@/types/chat";

export const MUTE_OPTIONS = [
  { label: "For 8 hours", hours: 8 },
  { label: "For 1 week", hours: 24 * 7 },
  { label: "Always", hours: 24 * 365 * 100 },
] as const;

export const ConversationListItem = memo(function ConversationListItem({
  conversation,
  active,
  myUserId,
  now,
  onUpdate,
}: {
  conversation: ConversationSummary;
  active: boolean;
  myUserId: string;
  now: number;
  onUpdate: (patch: Partial<Pick<ConversationSummary, "pinned_at" | "archived_at" | "muted_until">>) => void;
}) {
  const online = useIsOnline(conversation.type === "direct" ? conversation.peer?.id : null);
  const title = conversationTitle(conversation);
  const last = conversation.last_message;
  const muted = isMuted(conversation, now);
  const unread = conversation.unread_count;

  let preview = last ? messagePreview({ ...last, metadata: last.metadata ?? null }) : "No messages yet";
  if (last && !last.deleted_at && last.message_type !== "system" && last.message_type !== "call") {
    if (last.sender_id === myUserId) preview = `You: ${preview}`;
    else if (conversation.type === "group" && last.sender_name) preview = `${last.sender_name.split(" ")[0]}: ${preview}`;
  }

  return (
    <li className="group/item relative">
      <Link
        href={`/chats/${conversation.id}`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 pr-10 transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none",
          active && "bg-accent",
        )}
      >
        <UserAvatar name={title} path={conversation.type === "group" ? conversation.avatar_path : conversation.peer?.avatar_path} online={online} isGroup={conversation.type === "group"} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate font-medium">{title}</span>
            <span className={cn("ml-auto shrink-0 text-xs", unread > 0 && !muted ? "font-medium text-primary" : "text-muted-foreground")}>
              {formatListTimestamp(last?.created_at ?? conversation.last_message_at)}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            {conversation.active_call && (
              <span className="flex items-center gap-1 text-xs font-medium text-success" aria-label="Call in progress">
                {conversation.active_call.media_type === "video" ? <Video className="size-3.5" /> : <Phone className="size-3.5" />}
                Call
              </span>
            )}
            <span className={cn("truncate text-sm text-muted-foreground", last?.deleted_at && "italic")}>{preview}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {muted && <BellOff className="size-3.5 text-muted-foreground" aria-label="Muted" />}
              {conversation.pinned_at && <Pin className="size-3.5 text-muted-foreground" aria-label="Pinned" />}
              {conversation.mention_count > 0 && (
                <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground" aria-label="Mentioned">
                  @
                </span>
              )}
              {unread > 0 && (
                <span
                  className={cn(
                    "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold",
                    muted ? "bg-muted-foreground/40 text-background" : "bg-primary text-primary-foreground",
                  )}
                  aria-label={`${unread} unread`}
                >
                  {formatUnread(unread)}
                </span>
              )}
            </span>
          </span>
        </span>
      </Link>
      <div className="absolute top-1/2 right-1 -translate-y-1/2 opacity-100 md:opacity-0 md:group-focus-within/item:opacity-100 md:group-hover/item:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Options for ${title}`}>
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onUpdate({ pinned_at: conversation.pinned_at ? null : new Date().toISOString() })}>
              {conversation.pinned_at ? <PinOff /> : <Pin />}
              {conversation.pinned_at ? "Unpin" : "Pin to top"}
            </DropdownMenuItem>
            {muted ? (
              <DropdownMenuItem onSelect={() => onUpdate({ muted_until: null })}>
                <BellOff />
                Unmute
              </DropdownMenuItem>
            ) : (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <BellOff />
                  Mute
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {MUTE_OPTIONS.map((option) => (
                    <DropdownMenuItem
                      key={option.hours}
                      onSelect={() => onUpdate({ muted_until: new Date(Date.now() + option.hours * 3600_000).toISOString() })}
                    >
                      {option.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onUpdate({ archived_at: conversation.archived_at ? null : new Date().toISOString() })}>
              {conversation.archived_at ? <ArchiveRestore /> : <Archive />}
              {conversation.archived_at ? "Unarchive" : "Archive"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
});
