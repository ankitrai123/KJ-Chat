import { describe, expect, it } from "vitest";
import {
  addReaction,
  emptyPages,
  flattenMessages,
  groupReactions,
  type MessagePages,
  removeMessage,
  removeReaction,
  updateMessage,
  upsertMessages,
} from "@/lib/chat/message-cache";
import type { ChatMessage } from "@/types/chat";

let seq = 0;
function message(partial: Partial<ChatMessage> = {}): ChatMessage {
  seq += 1;
  const ts = `2026-10-13T12:00:${String(seq).padStart(2, "0")}.000000+00:00`;
  return {
    id: `m${seq}`,
    conversation_id: "c1",
    sender_id: "u1",
    client_id: `client-${seq}`,
    message_type: "text",
    content: `message ${seq}`,
    metadata: {},
    reply_to_message_id: null,
    is_forwarded: false,
    created_at: ts,
    updated_at: ts,
    edited_at: null,
    deleted_at: null,
    attachments: [],
    reactions: [],
    reply_to: null,
    localStatus: "sent",
    ...partial,
  };
}

describe("message cache", () => {
  it("inserts new messages in order and ignores duplicates (idempotent realtime events)", () => {
    const a = message();
    const b = message();
    let data = upsertMessages(undefined, [b]);
    data = upsertMessages(data, [a]);
    data = upsertMessages(data, [b]);
    expect(flattenMessages(data).map((m) => m.id)).toEqual([a.id, b.id]);
  });

  it("replaces an optimistic message by client id when the server copy arrives", () => {
    const pending = message({ id: "client-x", client_id: "client-x", localStatus: "pending" });
    const confirmed = { ...pending, id: "server-x", localStatus: "sent" as const };
    let data = upsertMessages(undefined, [pending]);
    data = upsertMessages(data, [confirmed]);
    const list = flattenMessages(data);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "server-x", localStatus: "sent" });
  });

  it("keeps unconfirmed messages after confirmed ones", () => {
    const pending = message({ localStatus: "pending" });
    const later = message();
    const data = upsertMessages(undefined, [pending, later]);
    expect(flattenMessages(data).map((m) => m.id)).toEqual([later.id, pending.id]);
  });

  it("does not let a stale event overwrite a newer edit", () => {
    const original = message();
    const edited = { ...original, content: "edited", updated_at: "2026-10-13T13:00:00.000000+00:00" };
    let data = upsertMessages(undefined, [edited]);
    data = upsertMessages(data, [original]);
    expect(flattenMessages(data)[0].content).toBe("edited");
  });

  it("flattens multiple pages oldest-first without duplicates", () => {
    const older = [message(), message()];
    const newer = [message(), message()];
    const data: MessagePages = {
      pages: [
        { messages: newer, nextCursor: newer[0].id },
        { messages: [...older, newer[0]], nextCursor: null },
      ],
      pageParams: [null, newer[0].id],
    };
    expect(flattenMessages(data).map((m) => m.id)).toEqual([...older, ...newer].map((m) => m.id));
  });

  it("updates and removes messages by id or client id", () => {
    const m = message();
    let data: MessagePages | undefined = upsertMessages(emptyPages(), [m]);
    data = updateMessage(data, m.client_id!, (x) => ({ ...x, content: "changed" }));
    expect(flattenMessages(data)[0].content).toBe("changed");
    data = removeMessage(data, m.id);
    expect(flattenMessages(data)).toEqual([]);
  });

  it("adds reactions once and removes them by id or by user+emoji", () => {
    const m = message();
    let data: MessagePages | undefined = upsertMessages(undefined, [m]);
    const reaction = { id: "r1", user_id: "u2", emoji: "👍", created_at: m.created_at };
    data = addReaction(data, m.id, reaction);
    data = addReaction(data, m.id, reaction);
    expect(flattenMessages(data)[0].reactions).toHaveLength(1);

    // An optimistic placeholder is replaced by the server row with the same user+emoji.
    data = addReaction(data, m.id, { ...reaction, id: "server-r1" });
    expect(flattenMessages(data)[0].reactions.map((r) => r.id)).toEqual(["server-r1"]);

    data = removeReaction(data, m.id, { id: "server-r1" });
    expect(flattenMessages(data)[0].reactions).toHaveLength(0);
  });

  it("groups reactions with counts and marks mine", () => {
    const groups = groupReactions(
      [
        { id: "1", user_id: "me", emoji: "👍", created_at: "" },
        { id: "2", user_id: "you", emoji: "👍", created_at: "" },
        { id: "3", user_id: "you", emoji: "😂", created_at: "" },
      ],
      "me",
    );
    expect(groups).toEqual([
      { emoji: "👍", count: 2, userIds: ["me", "you"], mine: true },
      { emoji: "😂", count: 1, userIds: ["you"], mine: false },
    ]);
  });
});
