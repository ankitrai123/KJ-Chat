import { describe, expect, it } from "vitest";
import { readBy, receiptState } from "@/lib/chat/receipts";
import { compareTimestamps, formatCallDuration, formatDuration, formatLastSeen, formatListTimestamp, toMicros } from "@/lib/chat/time";
import { initials } from "@/lib/utils";

describe("toMicros", () => {
  it("keeps microsecond precision that JavaScript Dates drop", () => {
    const a = "2026-10-13T12:00:00.123456+00:00";
    const b = "2026-10-13T12:00:00.123457+00:00";
    expect(Date.parse(a)).toBe(Date.parse(b));
    expect(toMicros(b) - toMicros(a)).toBe(1);
    expect(compareTimestamps(a, b)).toBeLessThan(0);
  });

  it("handles offsets, Z suffix, short fractions and space separators", () => {
    const base = toMicros("2026-10-13T12:00:00Z");
    expect(toMicros("2026-10-13T14:00:00+02:00")).toBe(base);
    expect(toMicros("2026-10-13 12:00:00.5+00")).toBe(base + 500_000);
    expect(toMicros("2026-10-13T12:00:00.123Z")).toBe(base + 123_000);
  });
});

describe("formatting", () => {
  it("formats durations", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3723)).toBe("1:02:03");
  });

  it("formats call lengths for people", () => {
    expect(formatCallDuration(42)).toBe("42 sec");
    expect(formatCallDuration(754)).toBe("12 min");
    expect(formatCallDuration(3900)).toBe("1 hr 5 min");
  });

  it("builds avatar initials from words, skipping emoji", () => {
    expect(initials("Ana Lima")).toBe("AL");
    expect(initials("Weekend trip 🏕️")).toBe("WT");
    expect(initials("🎉 Party")).toBe("P");
    expect(initials("")).toBe("?");
  });

  it("formats list timestamps relative to now", () => {
    const now = new Date("2026-10-13T15:00:00");
    expect(formatListTimestamp("2026-10-13T09:05:00", now)).toBe("09:05");
    expect(formatListTimestamp("2026-10-12T09:05:00", now)).toBe("Yesterday");
    expect(formatListTimestamp("2026-10-09T09:05:00", now)).toBe("Friday");
    expect(formatListTimestamp("2026-01-02T09:05:00", now)).toBe("2 Jan");
    expect(formatListTimestamp(null, now)).toBe("");
  });

  it("formats last seen", () => {
    const now = new Date("2026-10-13T15:00:00");
    expect(formatLastSeen("2026-10-13T14:59:40", now)).toBe("last seen just now");
    expect(formatLastSeen("2026-10-13T14:30:00", now)).toBe("last seen 30 min ago");
    expect(formatLastSeen("2026-10-13T09:00:00", now)).toBe("last seen today at 09:00");
  });
});

describe("receiptState", () => {
  const msg = { created_at: "2026-10-13T12:00:00.000002+00:00", localStatus: "sent" as const };
  const member = (user_id: string, read: string | null, delivered: string | null) => ({ user_id, last_read_at: read, last_delivered_at: delivered });

  it("reflects local pending/failed states first", () => {
    expect(receiptState({ ...msg, localStatus: "pending" }, [], "me")).toBe("pending");
    expect(receiptState({ ...msg, localStatus: "failed" }, [], "me")).toBe("failed");
  });

  it("is read only when the reader's marker reaches the exact message time", () => {
    const justBefore = "2026-10-13T12:00:00.000001+00:00";
    expect(receiptState(msg, [member("me", null, null), member("bob", justBefore, justBefore)], "me")).toBe("sent");
    expect(receiptState(msg, [member("bob", msg.created_at, msg.created_at)], "me")).toBe("read");
    expect(receiptState(msg, [member("bob", null, msg.created_at)], "me")).toBe("delivered");
  });

  it("requires every group member for read/delivered", () => {
    const later = "2026-10-13T13:00:00+00:00";
    const members = [member("bob", later, later), member("cat", null, later)];
    expect(receiptState(msg, members, "me")).toBe("delivered");
    expect(receiptState(msg, [member("bob", later, later), member("cat", later, later)], "me")).toBe("read");
  });

  it("hides read state when I disabled read receipts", () => {
    const later = "2026-10-13T13:00:00+00:00";
    expect(receiptState(msg, [member("bob", later, later)], "me", { showReadReceipts: false })).toBe("delivered");
  });

  it("lists readers excluding the sender", () => {
    const later = "2026-10-13T13:00:00+00:00";
    expect(readBy({ created_at: msg.created_at, sender_id: "me" }, [member("me", later, later), member("bob", later, later), member("cat", null, later)])).toEqual(["bob"]);
  });
});
