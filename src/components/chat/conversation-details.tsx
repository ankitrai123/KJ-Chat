"use client";

import { Ban, Flag, LogOut, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { GroupInvites } from "@/components/groups/group-invites";
import { GroupAvatarButton, GroupInfoEditor } from "@/components/groups/group-info-editor";
import { GroupMembers } from "@/components/groups/group-members";
import { UserAvatar } from "@/components/profile/user-avatar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUpdatePreferences } from "@/hooks/use-conversations";
import { isMuted } from "@/lib/chat/conversations";
import { canEditGroupInfo } from "@/lib/chat/permissions";
import { type ConversationSummary, conversationTitle, type MemberWithProfile } from "@/types/chat";
import { SharedMedia } from "./shared-media";

export function ConversationDetails({
  conversation,
  members,
  myUserId,
  isBlocked,
  onBlockToggle,
  onReport,
  onLeave,
  onDelete,
  onMessage,
}: {
  conversation: ConversationSummary;
  members: MemberWithProfile[];
  myUserId: string;
  isBlocked: boolean;
  onBlockToggle: () => void;
  onReport: () => void;
  onLeave: () => void;
  onDelete: () => void;
  onMessage: (userId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const updatePreferences = useUpdatePreferences();
  const isGroup = conversation.type === "group";
  const isAdmin = canEditGroupInfo(conversation.my_role);
  const peerMember = !isGroup ? members.find((m) => m.user_id !== myUserId) : undefined;
  const title = conversationTitle(conversation);
  const muted = isMuted(conversation);

  return (
    <div className="grid gap-5 p-4">
      <section className="grid justify-items-center gap-2 text-center">
        {isGroup ? (
          <GroupAvatarButton conversation={conversation} canEdit={isAdmin} />
        ) : (
          <UserAvatar name={title} path={conversation.peer?.avatar_path} size="2xl" />
        )}
        {editing ? (
          <div className="w-full text-left">
            <GroupInfoEditor conversation={conversation} onDone={() => setEditing(false)} />
          </div>
        ) : (
          <>
            <h2 className="flex items-center gap-1 text-xl font-semibold">
              {title}
              {isGroup && isAdmin && (
                <Button size="icon-sm" variant="ghost" onClick={() => setEditing(true)} aria-label="Edit group info">
                  <Pencil />
                </Button>
              )}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isGroup ? `Group · ${conversation.member_count} members` : conversation.peer ? `@${conversation.peer.username}` : "Account deleted"}
            </p>
            {(isGroup ? conversation.description : (peerMember?.profile?.bio ?? conversation.peer?.status_text)) && (
              <p className="max-w-prose text-sm whitespace-pre-wrap">{isGroup ? conversation.description : (peerMember?.profile?.bio ?? conversation.peer?.status_text)}</p>
            )}
          </>
        )}
      </section>

      <Separator />

      <section className="grid gap-3" aria-label="Notifications">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="details-mute">Mute notifications</Label>
          <Switch
            id="details-mute"
            checked={muted}
            onCheckedChange={(checked) =>
              updatePreferences.mutate({
                conversationId: conversation.id,
                patch: { muted_until: checked ? new Date(Date.now() + 100 * 365 * 24 * 3600_000).toISOString() : null },
              })
            }
          />
        </div>
        {isGroup && (
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="details-level">Notify me about</Label>
            <Select
              value={conversation.notification_level}
              onValueChange={(value) =>
                updatePreferences.mutate({ conversationId: conversation.id, patch: { notification_level: value as "all" | "mentions" | "none" } })
              }
            >
              <SelectTrigger id="details-level" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All messages</SelectItem>
                <SelectItem value="mentions">Mentions only</SelectItem>
                <SelectItem value="none">Nothing</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </section>

      <Separator />

      <Tabs defaultValue={isGroup ? "members" : "media"}>
        <TabsList className="w-full">
          {isGroup && <TabsTrigger value="members">Members</TabsTrigger>}
          <TabsTrigger value="media">Media</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="audio">Audio</TabsTrigger>
        </TabsList>
        {isGroup && (
          <TabsContent value="members" className="pt-2">
            <GroupMembers conversation={conversation} members={members} myUserId={myUserId} onMessage={onMessage} />
          </TabsContent>
        )}
        <TabsContent value="media" className="pt-2">
          <SharedMedia conversationId={conversation.id} tab="media" clearedAt={conversation.cleared_at} />
        </TabsContent>
        <TabsContent value="files" className="pt-2">
          <SharedMedia conversationId={conversation.id} tab="files" clearedAt={conversation.cleared_at} />
        </TabsContent>
        <TabsContent value="audio" className="pt-2">
          <SharedMedia conversationId={conversation.id} tab="audio" clearedAt={conversation.cleared_at} />
        </TabsContent>
      </Tabs>

      {isGroup && isAdmin && (
        <>
          <Separator />
          <GroupInvites conversationId={conversation.id} />
        </>
      )}

      <Separator />

      <section className="grid gap-2">
        {!isGroup && conversation.peer && (
          <>
            <Button variant="outline" className="justify-start" onClick={onBlockToggle}>
              <Ban /> {isBlocked ? `Unblock ${title}` : `Block ${title}`}
            </Button>
            <Button variant="outline" className="justify-start text-destructive" onClick={onReport}>
              <Flag /> Report {title}
            </Button>
          </>
        )}
        {isGroup && (
          <Button variant="outline" className="justify-start text-destructive" onClick={onLeave}>
            <LogOut /> Leave group
          </Button>
        )}
        {isGroup && conversation.my_role === "owner" && (
          <Button variant="destructive" className="justify-start" onClick={onDelete}>
            <Trash2 /> Delete group for everyone
          </Button>
        )}
      </section>
    </div>
  );
}
