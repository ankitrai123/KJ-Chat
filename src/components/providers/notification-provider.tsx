"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import type * as React from "react";
import { toast } from "sonner";
import { useConversations } from "@/hooks/use-conversations";
import { totalUnread } from "@/lib/chat/conversations";
import { messagePreview } from "@/lib/chat/format";
import { registerServiceWorker } from "@/lib/notifications/push.client";
import { shouldNotifyMessage } from "@/lib/notifications/rules";
import { realtimeBus } from "@/lib/realtime/bus";
import { conversationTitle } from "@/types/chat";
import { useSession } from "./session-provider";

/**
 * Foreground notifications while the app is open:
 *  - in-app toast for messages in conversations you're not looking at,
 *  - a system notification when the tab is hidden (if permission was granted),
 *  - unread count in the tab title and on the installed app icon.
 * Background delivery (tab closed) is handled by web push + the service worker.
 */
export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { userId, profile, settings } = useSession();
  const { data: conversations } = useConversations();
  const pathname = usePathname();
  const router = useRouter();
  const latest = useRef({ conversations, pathname, settings, profile });

  useEffect(() => {
    latest.current = { conversations, pathname, settings, profile };
  });

  useEffect(() => {
    void registerServiceWorker();
  }, []);

  // Unread badge: document title + installed-app badge where supported.
  const unread = totalUnread(conversations ?? []);
  useEffect(() => {
    const base = "KJ Chat";
    document.title = unread > 0 ? `(${unread > 99 ? "99+" : unread}) ${base}` : base;
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (unread > 0) void nav.setAppBadge?.(unread).catch(() => undefined);
    else void nav.clearAppBadge?.().catch(() => undefined);
  }, [unread]);

  useEffect(() => {
    return realtimeBus.on("message:insert", (row) => {
      if (!row.sender_id || row.sender_id === userId || row.message_type === "system") return;
      const { conversations: list, pathname: path, settings: prefs, profile: me } = latest.current;
      const conversation = list?.find((c) => c.id === row.conversation_id);
      const viewing = path === `/chats/${row.conversation_id}` && document.visibilityState === "visible" && document.hasFocus();
      if (viewing) return;

      const mentioned = Boolean(me.username && row.content?.toLowerCase().includes(`@${me.username}`));
      const allowed = shouldNotifyMessage(prefs, conversation ? { muted_until: conversation.muted_until, notification_level: conversation.notification_level } : null, { mentioned });
      if (!allowed) return;

      const title = conversation ? conversationTitle(conversation) : "New message";
      const preview = prefs.notification_previews
        ? messagePreview({ message_type: row.message_type, content: row.content, metadata: row.metadata as Record<string, unknown> })
        : "New message";
      const url = `/chats/${row.conversation_id}`;

      if (document.visibilityState === "visible") {
        toast(title, {
          description: preview.slice(0, 120),
          action: { label: "Open", onClick: () => router.push(url) },
        });
      } else if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        // Web push may also deliver this; the shared tag makes the OS show it once.
        const notification = new Notification(prefs.notification_previews ? title : "KJ Chat", {
          body: preview.slice(0, 180),
          tag: `conversation:${row.conversation_id}`,
          silent: !prefs.notification_sound,
        });
        notification.onclick = () => {
          window.focus();
          router.push(url);
          notification.close();
        };
      }
    });
  }, [router, userId]);

  return children;
}
