"use client";

import { Crown, MoreVertical, Shield, UserMinus, UserPlus } from "lucide-react";
import { useState } from "react";
import { useOnlineUsers } from "@/components/providers/presence-provider";
import { UserAvatar } from "@/components/profile/user-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/misc";
import { useGroupActions } from "@/hooks/use-group-actions";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ui/confirm-dialog";
import type { ConversationSummary, MemberWithProfile } from "@/types/chat";
import { AddMembersDialog } from "./add-members-dialog";

export function GroupMembers({
  conversation,
  members,
  myUserId,
  onMessage,
}: {
  conversation: ConversationSummary;
  members: MemberWithProfile[];
  myUserId: string;
  onMessage: (userId: string) => void;
}) {
  const actions = useGroupActions(conversation.id);
  const online = useOnlineUsers();
  const [addOpen, setAddOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const myRole = conversation.my_role;
  const isAdmin = myRole === "owner" || myRole === "admin";

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{members.length} members</h3>
        {isAdmin && (
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <UserPlus /> Add
          </Button>
        )}
      </div>
      <ul className="grid gap-1">
        {members.map((m) => {
          const isMe = m.user_id === myUserId;
          const canRemove = isAdmin && !isMe && m.role !== "owner" && (m.role !== "admin" || myRole === "owner");
          const canPromote = isAdmin && !isMe && m.role === "member";
          const canDemote = myRole === "owner" && !isMe && m.role === "admin";
          const canTransfer = myRole === "owner" && !isMe;
          const name = m.profile?.display_name ?? "Former member";
          return (
            <li key={m.user_id} className="flex items-center gap-3 rounded-md px-1 py-1.5">
              <UserAvatar name={name} path={m.profile?.avatar_path} size="sm" online={online.has(m.user_id)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {name}
                  {isMe && " (you)"}
                </span>
                <span className="block truncate text-xs text-muted-foreground">@{m.profile?.username}</span>
              </span>
              {m.role === "owner" && (
                <Badge variant="secondary">
                  <Crown /> Owner
                </Badge>
              )}
              {m.role === "admin" && (
                <Badge variant="secondary">
                  <Shield /> Admin
                </Badge>
              )}
              {!isMe && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-sm" variant="ghost" aria-label={`Options for ${name}`}>
                      <MoreVertical />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onMessage(m.user_id)}>Message {name.split(" ")[0]}</DropdownMenuItem>
                    {canPromote && <DropdownMenuItem onSelect={() => void actions.setRole(m.user_id, "admin")}>Make admin</DropdownMenuItem>}
                    {canDemote && <DropdownMenuItem onSelect={() => void actions.setRole(m.user_id, "member")}>Remove admin rights</DropdownMenuItem>}
                    {canTransfer && (
                      <DropdownMenuItem
                        onSelect={() =>
                          setConfirm({
                            title: `Make ${name} the owner?`,
                            description: "You'll become an admin. Only the new owner can transfer ownership back.",
                            confirmLabel: "Transfer ownership",
                            onConfirm: () => actions.setRole(m.user_id, "owner"),
                          })
                        }
                      >
                        Transfer ownership
                      </DropdownMenuItem>
                    )}
                    {canRemove && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() =>
                            setConfirm({
                              title: `Remove ${name}?`,
                              description: "They'll lose access to this group's messages and files.",
                              confirmLabel: "Remove",
                              destructive: true,
                              onConfirm: () => actions.removeMember(m.user_id),
                            })
                          }
                        >
                          <UserMinus /> Remove from group
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          );
        })}
      </ul>
      <AddMembersDialog open={addOpen} onOpenChange={setAddOpen} existingIds={members.map((m) => m.user_id)} onAdd={actions.addMembers} />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
