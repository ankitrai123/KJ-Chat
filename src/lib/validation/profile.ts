import { z } from "zod";
import { displayNameSchema } from "./auth";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,30}$/, "Use 3–30 lowercase letters, numbers or underscores.");

export const profileSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  bio: z.string().trim().max(500, "Bio must be 500 characters or fewer.").optional().default(""),
  statusText: z.string().trim().max(100, "Status must be 100 characters or fewer.").optional().default(""),
});

export type ProfileInput = z.input<typeof profileSchema>;

export const privacySettingsSchema = z.object({
  last_seen_visibility: z.enum(["everyone", "contacts", "nobody"]),
  show_online_status: z.boolean(),
  read_receipts_enabled: z.boolean(),
});

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Use HH:MM.");

export const notificationSettingsSchema = z.object({
  notify_messages: z.boolean(),
  notify_calls: z.boolean(),
  notification_previews: z.boolean(),
  notification_sound: z.boolean(),
  quiet_hours_enabled: z.boolean(),
  quiet_hours_start: timeSchema,
  quiet_hours_end: timeSchema,
  timezone: z.string().min(1).max(64),
});

export const reportSchema = z.object({
  reason: z.enum(["spam", "harassment", "inappropriate", "impersonation", "other"]),
  details: z.string().trim().max(1000, "Keep details under 1000 characters.").optional().default(""),
});
