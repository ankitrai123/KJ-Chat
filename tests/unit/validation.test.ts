import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema } from "@/lib/validation/auth";
import { createGroupSchema, pushSubscriptionSchema, sendMessageSchema } from "@/lib/validation/chat";
import { notificationSettingsSchema, profileSchema } from "@/lib/validation/profile";

const uuid = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

describe("auth schemas", () => {
  it("normalises email and requires matching passwords", () => {
    const ok = registerSchema.safeParse({
      displayName: " Ana ",
      email: " Ana@Example.COM ",
      password: "correct horse",
      confirmPassword: "correct horse",
    });
    expect(ok.success && ok.data).toMatchObject({ displayName: "Ana", email: "ana@example.com" });
    expect(ok.success && ok.data.inviteCode).toBeUndefined();

    const mismatch = registerSchema.safeParse({ displayName: "A", email: "a@b.co", password: "12345678", confirmPassword: "nope" });
    expect(mismatch.success).toBe(false);
    expect(registerSchema.safeParse({ displayName: "A", email: "a@b.co", password: "short", confirmPassword: "short" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
  });
});

describe("profile schema", () => {
  it("enforces the username format", () => {
    expect(profileSchema.safeParse({ username: "Ana_99", displayName: "Ana" }).success).toBe(true);
    expect(profileSchema.parse({ username: "Ana_99", displayName: "Ana" }).username).toBe("ana_99");
    for (const bad of ["ab", "has space", "dots.not.ok", "x".repeat(31)]) {
      expect(profileSchema.safeParse({ username: bad, displayName: "Ana" }).success).toBe(false);
    }
  });

  it("validates quiet hours times", () => {
    const base = {
      notify_messages: true,
      notify_calls: true,
      notification_previews: true,
      notification_sound: true,
      quiet_hours_enabled: true,
      timezone: "Europe/London",
    };
    expect(notificationSettingsSchema.safeParse({ ...base, quiet_hours_start: "22:00", quiet_hours_end: "07:30" }).success).toBe(true);
    expect(notificationSettingsSchema.safeParse({ ...base, quiet_hours_start: "25:00", quiet_hours_end: "07:30" }).success).toBe(false);
  });
});

describe("message schema", () => {
  const base = { conversationId: uuid(1), clientId: uuid(2) };

  it("requires text, attachments or a forward source", () => {
    expect(sendMessageSchema.safeParse({ ...base, content: "hi" }).success).toBe(true);
    expect(sendMessageSchema.safeParse({ ...base, content: "   " }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ ...base, forwardFromMessageId: uuid(3) }).success).toBe(true);
  });

  it("rejects oversized content and malformed attachment paths", () => {
    expect(sendMessageSchema.safeParse({ ...base, content: "x".repeat(4001) }).success).toBe(false);
    const attachment = { fileName: "a.png", mimeType: "image/png", size: 10, kind: "image" };
    expect(sendMessageSchema.safeParse({ ...base, attachments: [{ ...attachment, path: "../../etc/passwd" }] }).success).toBe(false);
    expect(
      sendMessageSchema.safeParse({ ...base, attachments: [{ ...attachment, path: `${uuid(1)}/${uuid(2)}/${uuid(3)}/a.png` }] }).success,
    ).toBe(true);
  });

  it("caps attachments and forbids mixing forwards with new uploads", () => {
    const attachment = { fileName: "a.png", mimeType: "image/png", size: 10, kind: "image", path: `${uuid(1)}/${uuid(2)}/${uuid(3)}/a.png` };
    expect(sendMessageSchema.safeParse({ ...base, attachments: Array(11).fill(attachment) }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ ...base, forwardFromMessageId: uuid(3), attachments: [attachment] }).success).toBe(false);
  });
});

describe("other schemas", () => {
  it("validates groups and push subscriptions", () => {
    expect(createGroupSchema.safeParse({ name: "Trip", memberIds: [uuid(1)] }).success).toBe(true);
    expect(createGroupSchema.safeParse({ name: "", memberIds: [] }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ endpoint: "https://push.example/abc", keys: { p256dh: "x".repeat(20), auth: "y".repeat(10) } }).success).toBe(true);
    expect(pushSubscriptionSchema.safeParse({ endpoint: "http://push.example/abc", keys: { p256dh: "x".repeat(20), auth: "y".repeat(10) } }).success).toBe(false);
  });
});
