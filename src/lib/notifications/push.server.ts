import "server-only";

import webpush, { type PushSubscription, WebPushError } from "web-push";
import { messagePreview } from "@/lib/chat/format";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import type { AdminSupabase } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";
import { isWithinQuietHours, shouldNotifyMessage } from "./rules";

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];
type CallRow = Database["public"]["Tables"]["call_sessions"]["Row"];

export interface PushPayload {
  type: "message" | "call";
  title: string;
  body: string;
  tag: string;
  url: string;
  conversationId: string;
  callId?: string;
}

let configured: boolean | null = null;

export function isPushConfigured(): boolean {
  if (configured !== null) return configured;
  configured = Boolean(publicEnv.vapidPublicKey && serverEnv.vapidPrivateKey && serverEnv.vapidSubject);
  if (configured) webpush.setVapidDetails(serverEnv.vapidSubject, publicEnv.vapidPublicKey, serverEnv.vapidPrivateKey);
  return configured;
}

async function deliver(admin: AdminSupabase, userIds: string[], payloadFor: (userId: string) => PushPayload | null) {
  if (!userIds.length) return;
  const { data: subs } = await admin.from("push_subscriptions").select("*").in("user_id", userIds);
  if (!subs?.length) return;

  await Promise.allSettled(
    subs.map(async (sub) => {
      const payload = payloadFor(sub.user_id);
      if (!payload) return;
      const subscription: PushSubscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
      try {
        await webpush.sendNotification(subscription, JSON.stringify(payload), {
          TTL: payload.type === "call" ? 45 : 3600,
          urgency: "high",
        });
        await admin.from("push_subscriptions").update({ last_used_at: new Date().toISOString(), failure_count: 0 }).eq("id", sub.id);
      } catch (error) {
        const status = error instanceof WebPushError ? error.statusCode : 0;
        if (status === 404 || status === 410) {
          // The browser unsubscribed or the subscription expired.
          await admin.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          await admin.from("push_subscriptions").update({ failure_count: sub.failure_count + 1 }).eq("id", sub.id);
        }
      }
    }),
  );
}

/** Web push for a new message, honouring mute, mention-only, quiet hours and preview privacy. */
export async function notifyNewMessage(admin: AdminSupabase, message: MessageRow): Promise<void> {
  if (!isPushConfigured() || !message.sender_id) return;
  const senderId = message.sender_id;

  const [{ data: conversation }, { data: members }, { data: sender }] = await Promise.all([
    admin.from("conversations").select("id, type, name").eq("id", message.conversation_id).single(),
    admin.from("conversation_members").select("user_id").eq("conversation_id", message.conversation_id).neq("user_id", senderId),
    admin.from("profiles").select("display_name").eq("id", senderId).single(),
  ]);
  const recipientIds = (members ?? []).map((m) => m.user_id);
  if (!conversation || !recipientIds.length) return;

  const [{ data: prefs }, { data: settings }, { data: mentions }, { data: blocks }, { data: attachments }] = await Promise.all([
    admin.from("conversation_preferences").select("user_id, muted_until, notification_level").eq("conversation_id", conversation.id),
    admin.from("user_settings").select("*").in("user_id", recipientIds),
    admin.from("message_mentions").select("user_id").eq("message_id", message.id),
    admin.from("user_blocks").select("blocker_id").eq("blocked_id", senderId).in("blocker_id", recipientIds),
    admin.from("attachments").select("kind").eq("message_id", message.id).limit(1),
  ]);

  const mentioned = new Set((mentions ?? []).map((m) => m.user_id));
  const blockedBy = new Set((blocks ?? []).map((b) => b.blocker_id));
  const prefsByUser = new Map((prefs ?? []).map((p) => [p.user_id, p]));
  const settingsByUser = new Map((settings ?? []).map((s) => [s.user_id, s]));

  const senderName = sender?.display_name ?? "Someone";
  const preview = messagePreview({
    message_type: message.message_type,
    content: message.content,
    attachment_kind: attachments?.[0]?.kind ?? null,
  });
  const isGroup = conversation.type === "group";

  const eligible = recipientIds.filter((userId) => {
    const s = settingsByUser.get(userId);
    if (!s || blockedBy.has(userId)) return false;
    return shouldNotifyMessage(s, prefsByUser.get(userId) ?? null, { mentioned: mentioned.has(userId) });
  });

  await deliver(admin, eligible, (userId) => {
    const showPreview = settingsByUser.get(userId)?.notification_previews ?? true;
    const body = showPreview ? (isGroup ? `${senderName}: ${preview}` : preview) : "New message";
    return {
      type: "message",
      title: showPreview ? (isGroup ? (conversation.name ?? "Group") : senderName) : "KJ Chat",
      body: body.slice(0, 180),
      tag: `conversation:${conversation.id}`,
      url: `/chats/${conversation.id}`,
      conversationId: conversation.id,
    };
  });
}

/** Best-effort push for an incoming call (browsers may not show it while fully closed). */
export async function notifyIncomingCall(admin: AdminSupabase, call: CallRow, invitedUserIds: string[]): Promise<void> {
  if (!isPushConfigured() || !call.started_by || !invitedUserIds.length) return;
  const [{ data: caller }, { data: conversation }, { data: settings }] = await Promise.all([
    admin.from("profiles").select("display_name").eq("id", call.started_by).single(),
    admin.from("conversations").select("type, name").eq("id", call.conversation_id).single(),
    admin.from("user_settings").select("*").in("user_id", invitedUserIds),
  ]);
  const now = new Date();
  const eligible = (settings ?? [])
    .filter((s) => s.notify_calls && !(s.quiet_hours_enabled && isWithinQuietHours(now, s.quiet_hours_start, s.quiet_hours_end, s.timezone)))
    .map((s) => s.user_id);

  const kind = call.media_type === "video" ? "video" : "voice";
  const callerName = caller?.display_name ?? "Someone";
  await deliver(admin, eligible, () => ({
    type: "call",
    title: `Incoming ${kind} call`,
    body: conversation?.type === "group" ? `${callerName} in ${conversation.name ?? "a group"}` : `${callerName} is calling`,
    tag: `call:${call.id}`,
    url: `/chats/${call.conversation_id}?call=${call.id}`,
    conversationId: call.conversation_id,
    callId: call.id,
  }));
}
