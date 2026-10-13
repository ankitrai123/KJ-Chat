import { z } from "zod";
import type { ConversationSummaryRow, Json, MessageDetailsRow, MessageType } from "@/types/database";

export interface Profile {
  id: string;
  username: string | null;
  display_name: string;
  avatar_path: string | null;
  bio?: string | null;
  status_text?: string | null;
}

const attachmentSchema = z.object({
  id: z.string(),
  storage_path: z.string(),
  file_name: z.string(),
  mime_type: z.string(),
  file_size: z.number(),
  kind: z.enum(["image", "video", "audio", "voice", "file"]),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  duration_ms: z.number().nullable().optional(),
  waveform: z.array(z.number()).nullable().optional(),
});

const reactionSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  emoji: z.string(),
  created_at: z.string(),
});

const replySchema = z.object({
  id: z.string(),
  sender_id: z.string().nullable(),
  message_type: z.string(),
  content: z.string().nullable(),
  deleted_at: z.string().nullable(),
  attachment_kind: z.string().nullable().optional(),
});

export type Attachment = z.infer<typeof attachmentSchema>;
export type Reaction = z.infer<typeof reactionSchema>;
export type ReplyPreview = z.infer<typeof replySchema>;

/** Client-side delivery state of the current user's own messages. */
export type LocalStatus = "pending" | "failed" | "sent";

export interface PendingPayload {
  content?: string;
  replyToMessageId?: string;
  forwardFromMessageId?: string;
  attachments?: unknown[];
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  client_id: string | null;
  message_type: MessageType;
  content: string | null;
  metadata: Record<string, unknown>;
  reply_to_message_id: string | null;
  is_forwarded: boolean;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  attachments: Attachment[];
  reactions: Reaction[];
  reply_to: ReplyPreview | null;
  /** Only present on messages created in this browser session. */
  localStatus?: LocalStatus;
  localError?: string;
  /** False when the server rejected the message permanently (e.g. blocked); no auto-retry. */
  localRetryable?: boolean;
  localPayload?: PendingPayload;
}

function parseArray<T>(schema: z.ZodType<T>, value: Json | null | undefined): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    const parsed = schema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function asRecord(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function normalizeMessage(row: MessageDetailsRow): ChatMessage {
  const reply = replySchema.safeParse(row.reply_to);
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    client_id: row.client_id,
    message_type: row.message_type,
    content: row.content,
    metadata: asRecord(row.metadata),
    reply_to_message_id: row.reply_to_message_id,
    is_forwarded: row.is_forwarded,
    created_at: row.created_at,
    updated_at: row.updated_at,
    edited_at: row.edited_at,
    deleted_at: row.deleted_at,
    attachments: parseArray(attachmentSchema, row.attachments),
    reactions: parseArray(reactionSchema, row.reactions),
    reply_to: reply.success ? reply.data : null,
    localStatus: "sent",
  };
}

const peerSchema = z.object({
  id: z.string(),
  username: z.string().nullable(),
  display_name: z.string(),
  avatar_path: z.string().nullable(),
  status_text: z.string().nullable().optional(),
});

const lastMessageSchema = z.object({
  id: z.string(),
  sender_id: z.string().nullable(),
  sender_name: z.string().nullable(),
  message_type: z.string(),
  content: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  attachment_count: z.number(),
});

const activeCallSchema = z.object({
  id: z.string(),
  media_type: z.enum(["audio", "video"]),
  status: z.enum(["ringing", "active", "ended"]),
  started_by: z.string().nullable(),
  created_at: z.string(),
});

export type ConversationPeer = z.infer<typeof peerSchema>;
export type LastMessagePreview = z.infer<typeof lastMessageSchema>;
export type ActiveCallInfo = z.infer<typeof activeCallSchema>;

export interface ConversationSummary
  extends Omit<ConversationSummaryRow, "peer" | "last_message" | "active_call"> {
  peer: ConversationPeer | null;
  last_message: LastMessagePreview | null;
  active_call: ActiveCallInfo | null;
}

export function normalizeConversation(row: ConversationSummaryRow): ConversationSummary {
  const peer = peerSchema.safeParse(row.peer);
  const last = lastMessageSchema.safeParse(row.last_message);
  const call = activeCallSchema.safeParse(row.active_call);
  return {
    ...row,
    peer: peer.success ? peer.data : null,
    last_message: last.success ? last.data : null,
    active_call: call.success ? call.data : null,
  };
}

export interface MemberWithProfile {
  conversation_id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
  last_read_at: string | null;
  last_delivered_at: string | null;
  profile: Profile | null;
}

export function conversationTitle(conversation: Pick<ConversationSummary, "type" | "name" | "peer">): string {
  if (conversation.type === "group") return conversation.name ?? "Group";
  return conversation.peer?.display_name ?? "Deleted account";
}
