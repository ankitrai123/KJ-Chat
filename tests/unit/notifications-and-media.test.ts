import { describe, expect, it } from "vitest";
import { normalizeWaveform } from "@/components/chat/voice-player";
import { compressLevels, describeMediaError, pickRecordingMimeType } from "@/hooks/use-voice-recorder";
import { isWithinQuietHours, shouldNotifyMessage } from "@/lib/notifications/rules";

const settings = {
  notify_messages: true,
  quiet_hours_enabled: false,
  quiet_hours_start: "22:00",
  quiet_hours_end: "07:00",
  timezone: "UTC",
};

describe("quiet hours", () => {
  it("handles ranges that wrap midnight", () => {
    expect(isWithinQuietHours(new Date("2026-10-13T23:30:00Z"), "22:00", "07:00", "UTC")).toBe(true);
    expect(isWithinQuietHours(new Date("2026-10-13T06:59:00Z"), "22:00", "07:00", "UTC")).toBe(true);
    expect(isWithinQuietHours(new Date("2026-10-13T07:00:00Z"), "22:00", "07:00", "UTC")).toBe(false);
    expect(isWithinQuietHours(new Date("2026-10-13T12:00:00Z"), "09:00", "17:00", "UTC")).toBe(true);
    expect(isWithinQuietHours(new Date("2026-10-13T12:00:00Z"), "09:00", "09:00", "UTC")).toBe(false);
  });

  it("evaluates in the user's time zone", () => {
    // 21:30 UTC is 23:30 in Berlin (CEST): inside 22:00–07:00 there, outside in UTC.
    const at = new Date("2026-07-01T21:30:00Z");
    expect(isWithinQuietHours(at, "22:00", "07:00", "Europe/Berlin")).toBe(true);
    expect(isWithinQuietHours(at, "22:00", "07:00", "UTC")).toBe(false);
    expect(isWithinQuietHours(at, "22:00", "07:00", "Not/AZone")).toBe(false);
  });
});

describe("shouldNotifyMessage", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const conversation = (patch: Partial<{ muted_until: string | null; notification_level: "all" | "mentions" | "none" }> = {}) => ({
    muted_until: null,
    notification_level: "all" as const,
    ...patch,
  });

  it("notifies by default", () => {
    expect(shouldNotifyMessage(settings, conversation(), { mentioned: false, now })).toBe(true);
  });

  it("respects the global switch and quiet hours", () => {
    expect(shouldNotifyMessage({ ...settings, notify_messages: false }, conversation(), { mentioned: true, now })).toBe(false);
    expect(
      shouldNotifyMessage({ ...settings, quiet_hours_enabled: true, quiet_hours_start: "11:00", quiet_hours_end: "13:00" }, conversation(), {
        mentioned: true,
        now,
      }),
    ).toBe(false);
  });

  it("lets mentions through a mute but not through 'nothing'", () => {
    const muted = conversation({ muted_until: "2026-12-01T00:00:00Z" });
    expect(shouldNotifyMessage(settings, muted, { mentioned: false, now })).toBe(false);
    expect(shouldNotifyMessage(settings, muted, { mentioned: true, now })).toBe(true);
    expect(shouldNotifyMessage(settings, conversation({ notification_level: "none" }), { mentioned: true, now })).toBe(false);
    expect(shouldNotifyMessage(settings, conversation({ notification_level: "mentions" }), { mentioned: false, now })).toBe(false);
    expect(shouldNotifyMessage(settings, conversation({ muted_until: "2026-10-01T00:00:00Z" }), { mentioned: false, now })).toBe(true);
  });
});

describe("voice recording helpers", () => {
  it("picks the first supported container", () => {
    expect(pickRecordingMimeType((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(pickRecordingMimeType((t) => t.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus");
    expect(pickRecordingMimeType(() => false)).toBeNull();
    expect(
      pickRecordingMimeType(() => {
        throw new Error("unsupported");
      }),
    ).toBeNull();
  });

  it("explains media errors", () => {
    expect(describeMediaError(new DOMException("x", "NotAllowedError"))).toMatch(/blocked/);
    expect(describeMediaError(new DOMException("x", "NotFoundError"), "camera")).toMatch(/No camera/);
    expect(describeMediaError(new DOMException("x", "NotReadableError"))).toMatch(/another app/);
  });

  it("compresses and normalises waveforms", () => {
    expect(compressLevels([1, 5, 2, 8], 2)).toEqual([5, 8]);
    expect(compressLevels([3, 4], 8)).toEqual([3, 4]);
    expect(normalizeWaveform([0, 100], 4)).toEqual([8, 8, 100, 100]);
    expect(normalizeWaveform(null, 5)).toHaveLength(5);
  });
});
