import { describe, expect, it } from "vitest";
import { filterConversations, formatUnread, isMuted, sortConversations, totalUnread } from "@/lib/chat/conversations";
import type { ConversationSummary } from "@/types/chat";

function conversation(partial: Partial<ConversationSummary>): ConversationSummary {
  return {
    id: Math.random().toString(36).slice(2),
    type: "direct",
    name: null,
    description: null,
    avatar_path: null,
    created_at: "2026-10-01T00:00:00+00:00",
    last_message_at: null,
    my_role: "member",
    member_count: 2,
    peer: { id: "p", username: "pat", display_name: "Pat", avatar_path: null },
    last_message: null,
    unread_count: 0,
    mention_count: 0,
    muted_until: null,
    archived_at: null,
    pinned_at: null,
    notification_level: "all",
    cleared_at: null,
    last_read_at: null,
    active_call: null,
    ...partial,
  };
}

describe("conversation list logic", () => {
  it("sorts pinned conversations first, then by latest activity", () => {
    const old = conversation({ id: "old", last_message_at: "2026-10-02T00:00:00+00:00" });
    const recent = conversation({ id: "recent", last_message_at: "2026-10-05T00:00:00+00:00" });
    const pinned = conversation({ id: "pinned", last_message_at: "2026-10-01T00:00:00+00:00", pinned_at: "2026-10-03T00:00:00+00:00" });
    expect(sortConversations([old, recent, pinned]).map((c) => c.id)).toEqual(["pinned", "recent", "old"]);
  });

  it("filters by tab and search text, keeping archived chats separate", () => {
    const list = [
      conversation({ id: "d", unread_count: 2 }),
      conversation({ id: "g", type: "group", name: "Family", peer: null }),
      conversation({ id: "a", archived_at: "2026-10-01T00:00:00+00:00" }),
    ];
    expect(filterConversations(list, "all").map((c) => c.id)).toEqual(["d", "g"]);
    expect(filterConversations(list, "unread").map((c) => c.id)).toEqual(["d"]);
    expect(filterConversations(list, "groups").map((c) => c.id)).toEqual(["g"]);
    expect(filterConversations(list, "archived").map((c) => c.id)).toEqual(["a"]);
    expect(filterConversations(list, "all", "fam").map((c) => c.id)).toEqual(["g"]);
    expect(filterConversations(list, "all", "pat").map((c) => c.id)).toEqual(["d"]);
  });

  it("counts unread for badges, respecting mute and notification level", () => {
    const now = Date.parse("2026-10-13T00:00:00Z");
    const list = [
      conversation({ unread_count: 3 }),
      conversation({ unread_count: 5, muted_until: "2026-12-01T00:00:00Z" }),
      conversation({ unread_count: 4, muted_until: "2026-12-01T00:00:00Z", mention_count: 1 }),
      conversation({ unread_count: 7, notification_level: "mentions", mention_count: 2 }),
      conversation({ unread_count: 9, archived_at: "2026-10-01T00:00:00Z" }),
    ];
    expect(totalUnread(list, now)).toBe(3 + 1 + 2);
  });

  it("knows when a mute has expired", () => {
    const now = Date.parse("2026-10-13T00:00:00Z");
    expect(isMuted({ muted_until: "2026-10-12T00:00:00Z" }, now)).toBe(false);
    expect(isMuted({ muted_until: "2026-10-14T00:00:00Z" }, now)).toBe(true);
    expect(isMuted({ muted_until: null }, now)).toBe(false);
  });

  it("caps unread labels", () => {
    expect(formatUnread(0)).toBe("");
    expect(formatUnread(12)).toBe("12");
    expect(formatUnread(150)).toBe("99+");
  });
});
