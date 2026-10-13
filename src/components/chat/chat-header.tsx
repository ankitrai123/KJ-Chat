"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Ban,
  Bell,
  BellOff,
  Eraser,
  Flag,
  Info,
  LogOut,
  MoreVertical,
  Phone,
  Search,
  Video,
} from "lucide-react";
import Link from "next/link";
import { useIsOnline, useLastSeen, useOnlineUsers } from "@/components/providers/presence-provider";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isMuted } from "@/lib/chat/conversations";
import { formatLastSeen } from "@/lib/chat/time";
import { type ConversationSummary, conversationTitle, type MemberWithProfile } from "@/types/chat";
import { MUTE_OPTIONS } from "./conversation-list-item";

function typingText(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names.length} people are typing…`;
}

export interface HeaderActions {
  onOpenDetails: () => void;
  onOpenSearch: () => void;
  onCall: (mediaType: "audio" | "video") => void;
  onMute: (until: string | null) => void;
  onArchive: (archived: boolean) => void;
  onClear: () => void;
  onBlockToggle: () => void;
  onReport: () => void;
  onLeave: () => void;
}

export function ChatHeader({
  conversation,
  members,
  typingNames,
  isBlocked,
  callsDisabled,
  actions,
}: {
  conversation: ConversationSummary;
  members: MemberWithProfile[];
  typingNames: string[];
  isBlocked: boolean;
  callsDisabled: boolean;
  actions: HeaderActions;
}) {
  const peerId = conversation.type === "direct" ? (conversation.peer?.id ?? null) : null;
  const peerOnline = useIsOnline(peerId);
  const { data: lastSeen } = useLastSeen(peerId && !peerOnline ? peerId : null);
  const onlineUsers = useOnlineUsers();
  const title = conversationTitle(conversation);
  const muted = isMuted(conversation);

  let subtitle: string;
  if (typingNames.length) subtitle = typingText(typingNames);
  else if (conversation.type === "group") {
    const online = members.filter((m) => onlineUsers.has(m.user_id)).length;
    subtitle = `${conversation.member_count} members${online > 1 ? `, ${online} online` : ""}`;
  } else if (!conversation.peer) subtitle = "Account deleted";
  else if (peerOnline) subtitle = "online";
  else subtitle = (lastSeen ? formatLastSeen(lastSeen) : conversation.peer.status_text) ?? "";

  return (
    <header className="flex items-center gap-1 border-b bg-background px-2 py-2 pt-safe">
      <Button asChild variant="ghost" size="icon" className="md:hidden">
        <Link href="/chats" aria-label="Back to conversations">
          <ArrowLeft />
        </Link>
      </Button>
      <button
        type="button"
        onClick={actions.onOpenDetails}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-0.5 text-left hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        aria-label={`${title}: view details`}
      >
        <UserAvatar
          name={title}
          path={conversation.type === "group" ? conversation.avatar_path : conversation.peer?.avatar_path}
          online={peerOnline}
          isGroup={conversation.type === "group"}
        />
        <span className="min-w-0">
          <span className="block truncate font-semibold">{title}</span>
          <span className={typingNames.length ? "block truncate text-xs text-primary" : "block truncate text-xs text-muted-foreground"} aria-live="polite">
            {subtitle}
          </span>
        </span>
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={() => actions.onCall("audio")} disabled={callsDisabled} aria-label="Start voice call">
            <Phone />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Voice call</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={() => actions.onCall("video")} disabled={callsDisabled} aria-label="Start video call">
            <Video />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Video call</TooltipContent>
      </Tooltip>
      <Button variant="ghost" size="icon" onClick={actions.onOpenSearch} aria-label="Search in conversation" className="hidden sm:inline-flex">
        <Search />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Conversation options">
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={actions.onOpenDetails}>
            <Info /> {conversation.type === "group" ? "Group info" : "Contact info"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={actions.onOpenSearch} className="sm:hidden">
            <Search /> Search
          </DropdownMenuItem>
          {muted ? (
            <DropdownMenuItem onSelect={() => actions.onMute(null)}>
              <Bell /> Unmute
            </DropdownMenuItem>
          ) : (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <BellOff /> Mute notifications
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {MUTE_OPTIONS.map((o) => (
                  <DropdownMenuItem key={o.hours} onSelect={() => actions.onMute(new Date(Date.now() + o.hours * 3600_000).toISOString())}>
                    {o.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuItem onSelect={() => actions.onArchive(!conversation.archived_at)}>
            {conversation.archived_at ? <ArchiveRestore /> : <Archive />}
            {conversation.archived_at ? "Unarchive" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={actions.onClear}>
            <Eraser /> {conversation.type === "direct" ? "Delete chat" : "Clear chat"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {conversation.type === "direct" && conversation.peer && (
            <>
              <DropdownMenuItem onSelect={actions.onBlockToggle} variant={isBlocked ? "default" : "destructive"}>
                <Ban /> {isBlocked ? "Unblock" : "Block"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={actions.onReport} variant="destructive">
                <Flag /> Report
              </DropdownMenuItem>
            </>
          )}
          {conversation.type === "group" && (
            <DropdownMenuItem onSelect={actions.onLeave} variant="destructive">
              <LogOut /> Leave group
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
