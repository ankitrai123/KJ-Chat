"use client";

import { CheckCheck } from "lucide-react";
import { UserAvatar } from "@/components/profile/user-avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatLastSeen, toMicros } from "@/lib/chat/time";
import type { ChatMessage, MemberWithProfile } from "@/types/chat";

/** Who has received/read one of my messages, from members' public receipts. */
export function MessageInfoDialog({
  message,
  members,
  myUserId,
  showReadReceipts,
  onClose,
}: {
  message: ChatMessage | null;
  members: MemberWithProfile[];
  myUserId: string;
  showReadReceipts: boolean;
  onClose: () => void;
}) {
  const created = message ? toMicros(message.created_at) : 0;
  const others = members.filter((m) => m.user_id !== myUserId);
  const read = others.filter((m) => m.last_read_at && toMicros(m.last_read_at) >= created);
  const delivered = others.filter((m) => !read.includes(m) && m.last_delivered_at && toMicros(m.last_delivered_at) >= created);
  const pending = others.filter((m) => !read.includes(m) && !delivered.includes(m));

  const section = (title: string, list: MemberWithProfile[], blue = false) =>
    list.length > 0 && (
      <section className="grid gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <CheckCheck className={blue ? "size-4 text-sky-600" : "size-4 text-muted-foreground"} aria-hidden /> {title}
        </h3>
        <ul className="grid gap-2">
          {list.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3">
              <UserAvatar name={m.profile?.display_name} path={m.profile?.avatar_path} size="sm" />
              <span className="flex-1 truncate text-sm">{m.profile?.display_name ?? "Former member"}</span>
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <Dialog open={Boolean(message)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Message info</DialogTitle>
          <DialogDescription>{message ? `Sent ${formatLastSeen(message.created_at).replace("last seen ", "")}` : ""}</DialogDescription>
        </DialogHeader>
        {showReadReceipts ? (
          section("Read", read, true)
        ) : (
          <p className="text-sm text-muted-foreground">You turned off read receipts, so you can&apos;t see who has read your messages.</p>
        )}
        {section("Delivered", showReadReceipts ? delivered : [...delivered, ...read])}
        {section("Not yet delivered", pending)}
        <p className="text-xs text-muted-foreground">People who turned off read receipts appear as delivered.</p>
      </DialogContent>
    </Dialog>
  );
}
