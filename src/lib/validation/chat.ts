import { z } from "zod";
import { ATTACHMENT_KINDS, MAX_ATTACHMENTS_PER_MESSAGE } from "@/lib/attachments/rules";

export const MAX_MESSAGE_LENGTH = 4000;

export const attachmentInputSchema = z.object({
  path: z
    .string()
    .max(400)
    .regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,200}$/, "Invalid attachment."),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(3).max(127),
  size: z.number().int().positive(),
  kind: z.enum(ATTACHMENT_KINDS),
  width: z.number().int().min(1).max(20000).optional(),
  height: z.number().int().min(1).max(20000).optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
  waveform: z.array(z.number().int().min(0).max(100)).max(128).optional(),
});

export const sendMessageSchema = z
  .object({
    conversationId: z.uuid(),
    clientId: z.uuid(),
    content: z.string().max(MAX_MESSAGE_LENGTH, `Messages can be at most ${MAX_MESSAGE_LENGTH} characters.`).optional(),
    replyToMessageId: z.uuid().optional(),
    attachments: z.array(attachmentInputSchema).max(MAX_ATTACHMENTS_PER_MESSAGE).optional().default([]),
    forwardFromMessageId: z.uuid().optional(),
  })
  .refine(
    (v) => Boolean(v.forwardFromMessageId) || Boolean(v.content?.trim()) || v.attachments.length > 0,
    { message: "Message is empty." },
  )
  .refine((v) => !(v.forwardFromMessageId && v.attachments.length > 0), {
    message: "Forwarded messages cannot include new attachments.",
  });

export type SendMessageInput = z.input<typeof sendMessageSchema>;
export type AttachmentInput = z.infer<typeof attachmentInputSchema>;

export const createGroupSchema = z.object({
  name: z.string().trim().min(1, "Enter a group name.").max(100, "Group names can be at most 100 characters."),
  description: z.string().trim().max(500, "Descriptions can be at most 500 characters.").optional().default(""),
  memberIds: z.array(z.uuid()).max(255, "Groups can have at most 256 members."),
});

export type CreateGroupInput = z.input<typeof createGroupSchema>;

export const startCallSchema = z.object({
  conversationId: z.uuid(),
  mediaType: z.enum(["audio", "video"]),
});

export const moderateCallSchema = z.object({
  action: z.enum(["mute", "remove"]),
  identity: z.uuid(),
  trackSid: z.string().max(64).optional(),
});

export const pushSubscriptionSchema = z.object({
  endpoint: z.url().max(2048).refine((u) => u.startsWith("https://"), "Push endpoints must use HTTPS."),
  keys: z.object({
    p256dh: z.string().min(16).max(256),
    auth: z.string().min(8).max(128),
  }),
});

export const deleteAccountSchema = z.object({
  confirmation: z.string(),
});
