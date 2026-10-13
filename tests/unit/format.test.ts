import { describe, expect, it } from "vitest";
import { isEmojiOnly, messagePreview, safeHref, systemEventText, tokenizeMessage } from "@/lib/chat/format";

describe("tokenizeMessage", () => {
  it("links http(s) URLs and leaves surrounding text intact", () => {
    expect(tokenizeMessage("see https://example.com/a?b=1, ok")).toEqual([
      { type: "text", value: "see " },
      { type: "link", value: "https://example.com/a?b=1", href: "https://example.com/a?b=1" },
      { type: "text", value: ", ok" },
    ]);
  });

  it("adds https to bare www links and links email addresses with mailto", () => {
    const tokens = tokenizeMessage("www.example.org or me@example.com");
    expect(tokens[0]).toMatchObject({ type: "link", href: "https://www.example.org/" });
    expect(tokens[2]).toMatchObject({ type: "link", href: "mailto:me@example.com" });
  });

  it("never turns javascript: or data: URLs into links", () => {
    for (const evil of ["javascript:alert(1)", "data:text/html,<script>x</script>", "vbscript:msgbox"]) {
      expect(tokenizeMessage(evil).every((t) => t.type === "text")).toBe(true);
    }
  });

  it("marks mentions only for mentionable usernames", () => {
    const tokens = tokenizeMessage("hi @alice and @bob", (u) => u === "alice");
    expect(tokens.filter((t) => t.type === "mention")).toEqual([{ type: "mention", value: "@alice", username: "alice" }]);
  });

  it("does not treat the local part of an email as a mention", () => {
    const tokens = tokenizeMessage("mail bob@example.com");
    expect(tokens.some((t) => t.type === "mention")).toBe(false);
  });

  it("keeps markup as plain text (rendered by React, never as HTML)", () => {
    expect(tokenizeMessage("<img src=x onerror=alert(1)>")).toEqual([{ type: "text", value: "<img src=x onerror=alert(1)>" }]);
  });
});

describe("safeHref", () => {
  it("accepts http, https and mailto only", () => {
    expect(safeHref("https://a.example")).toBe("https://a.example/");
    expect(safeHref("mailto:x@y.z")).toBe("mailto:x@y.z");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("ftp://files.example")).toBeNull();
    expect(safeHref("not a url")).toBeNull();
  });
});

describe("isEmojiOnly", () => {
  it("detects short emoji-only messages", () => {
    expect(isEmojiOnly("👍")).toBe(true);
    expect(isEmojiOnly("😂😂")).toBe(true);
    expect(isEmojiOnly("👨‍👩‍👧")).toBe(true);
    expect(isEmojiOnly("👍👍👍👍")).toBe(false);
    expect(isEmojiOnly("ok 👍")).toBe(false);
    expect(isEmojiOnly("")).toBe(false);
  });
});

describe("messagePreview", () => {
  it("summarises each message type", () => {
    expect(messagePreview({ message_type: "text", content: "hello\nworld" })).toBe("hello world");
    expect(messagePreview({ message_type: "image", content: null })).toBe("📷 Photo");
    expect(messagePreview({ message_type: "image", content: "beach" })).toBe("📷 beach");
    expect(messagePreview({ message_type: "voice", content: null })).toBe("🎤 Voice message");
    expect(messagePreview({ message_type: "file", content: null })).toBe("📄 Document");
    expect(messagePreview({ message_type: "text", content: "x", deleted_at: "2026-01-01" })).toBe("This message was deleted");
  });

  it("describes call outcomes", () => {
    expect(messagePreview({ message_type: "call", content: null, metadata: { media_type: "video", end_reason: "missed" } })).toBe("Missed video call");
    expect(messagePreview({ message_type: "call", content: null, metadata: { media_type: "audio", end_reason: "completed" } })).toBe("Voice call");
  });
});

describe("systemEventText", () => {
  const names: Record<string, string> = { a: "Ana", b: "Ben" };
  const nameOf = (id: string | null) => (id ? (names[id] ?? "Someone") : "Someone");

  it("renders group events with names", () => {
    expect(systemEventText({ event: "group_created", name: "Trip" }, nameOf, "a")).toBe('Ana created the group "Trip"');
    expect(systemEventText({ event: "members_added", user_ids: ["b"] }, nameOf, "a")).toBe("Ana added Ben");
    expect(systemEventText({ event: "member_removed", user_id: "b" }, nameOf, "a")).toBe("Ana removed Ben");
    expect(systemEventText({ event: "role_changed", user_id: "b", role: "admin" }, nameOf, "a")).toBe("Ana made Ben an admin");
  });
});
