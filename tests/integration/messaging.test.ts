import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  asOwner,
  asService,
  asUser,
  createGroup,
  createUser,
  createUsers,
  directConversation,
  expectDbError,
  sendMessage,
} from "./db/harness";

describe("direct conversations", () => {
  it("creates exactly one conversation per pair, from either side", async () => {
    const [alice, bob] = await createUsers(2);
    const first = await directConversation(alice, bob);
    const second = await directConversation(bob, alice);
    expect(second).toBe(first);
    const members = await asUser(alice.id, "select user_id from public.conversation_members where conversation_id = $1", [first]);
    expect(members.map((m) => m.user_id).sort()).toEqual([alice.id, bob.id].sort());
  });

  it("rejects messaging yourself and blocked users", async () => {
    const [alice, bob] = await createUsers(2);
    await expectDbError(asUser(alice.id, "select public.get_or_create_direct_conversation($1)", [alice.id]), { code: "22023" });
    await asUser(bob.id, "insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)", [bob.id, alice.id]);
    await expectDbError(asUser(alice.id, "select public.get_or_create_direct_conversation($1)", [bob.id]), {
      code: "42501",
      hint: "blocked",
    });
  });

  it("keeps conversations, members and messages invisible to non-members", async () => {
    const [alice, bob, eve] = await createUsers(3);
    const conv = await directConversation(alice, bob);
    await sendMessage(alice, conv, "secret");

    expect(await asUser(eve.id, "select * from public.conversations where id = $1", [conv])).toHaveLength(0);
    expect(await asUser(eve.id, "select * from public.conversation_members where conversation_id = $1", [conv])).toHaveLength(0);
    expect(await asUser(eve.id, "select * from public.messages where conversation_id = $1", [conv])).toHaveLength(0);
    expect(await asUser(eve.id, "select * from public.get_messages($1)", [conv])).toHaveLength(0);
    expect(await asUser(eve.id, "select * from public.message_details where conversation_id = $1", [conv])).toHaveLength(0);
    expect(await asUser(eve.id, "select * from public.search_messages('secret')")).toHaveLength(0);
    expect(await asUser(bob.id, "select * from public.search_messages('secret')")).toHaveLength(1);
  });
});

describe("sending messages", () => {
  it("cannot be done directly by end users (prevents sender impersonation)", async () => {
    const [alice, bob] = await createUsers(2);
    const conv = await directConversation(alice, bob);
    await expectDbError(
      asUser(alice.id, "select public.send_message($1, $2, $3, 'spoofed')", [bob.id, conv, randomUUID()]),
      { code: "42501" },
    );
    await expectDbError(
      asUser(alice.id, "insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'x')", [conv, bob.id]),
      { code: "42501" },
    );
    await expectDbError(asUser(alice.id, "update public.messages set content = 'x' where conversation_id = $1", [conv]), {
      code: "42501",
    });
    await expectDbError(asUser(alice.id, "delete from public.messages where conversation_id = $1", [conv]), { code: "42501" });
  });

  it("requires the sender to be a member", async () => {
    const [alice, bob, eve] = await createUsers(3);
    const conv = await directConversation(alice, bob);
    await expectDbError(sendMessage(eve, conv, "intrusion"), { code: "P0002" });
  });

  it("is idempotent per client id", async () => {
    const [alice, bob] = await createUsers(2);
    const conv = await directConversation(alice, bob);
    const clientId = randomUUID();
    const a = await sendMessage(alice, conv, "once", { clientId });
    const b = await sendMessage(alice, conv, "once", { clientId });
    expect(b.id).toBe(a.id);
    const rows = await asUser(bob.id, "select id from public.messages where conversation_id = $1", [conv]);
    expect(rows).toHaveLength(1);
  });

  it("rejects empty and oversized messages", async () => {
    const [alice, bob] = await createUsers(2);
    const conv = await directConversation(alice, bob);
    await expectDbError(sendMessage(alice, conv, "   "), { code: "22023" });
    await expectDbError(sendMessage(alice, conv, "x".repeat(4001)), { code: "22023" });
  });

  it("blocks sending in either direction once a user is blocked", async () => {
    const [alice, bob] = await createUsers(2);
    const conv = await directConversation(alice, bob);
    await sendMessage(alice, conv, "before block");
    await asUser(alice.id, "insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)", [alice.id, bob.id]);
    await expectDbError(sendMessage(bob, conv, "after block"), { code: "42501", hint: "blocked" });
    await expectDbError(sendMessage(alice, conv, "after block"), { code: "42501", hint: "blocked" });
    await asUser(alice.id, "delete from public.user_blocks where blocked_id = $1", [bob.id]);
    await sendMessage(bob, conv, "after unblock");
  });

  it("only allows replies to messages in the same conversation", async () => {
    const [alice, bob, carol] = await createUsers(3);
    const conv1 = await directConversation(alice, bob);
    const conv2 = await directConversation(alice, carol);
    const original = await sendMessage(bob, conv1, "question");
    await sendMessage(alice, conv1, "answer", { replyTo: original.id });
    await expectDbError(sendMessage(alice, conv2, "cross-post", { replyTo: original.id }), { code: "P0002" });
    const [reply] = await asUser(bob.id, "select reply_to from public.get_messages($1) where content = 'answer'", [conv1]);
    expect(reply.reply_to.id).toBe(original.id);
  });

  it("validates attachment paths so users cannot claim other people's uploads", async () => {
    const [alice, bob] = await createUsers(2);
    const conv = await directConversation(alice, bob);
    const attachment = (path: string) => ({
      path,
      kind: "image",
      file_name: "a.png",
      mime_type: "image/png",
      file_size: 10,
    });
    await expectDbError(
      sendMessage(alice, conv, null, { attachments: [attachment(`${conv}/${bob.id}/${randomUUID()}/a.png`)] }),
      { code: "22023" },
    );
    await expectDbError(
      sendMessage(alice, conv, null, { attachments: [attachment(`${randomUUID()}/${alice.id}/${randomUUID()}/a.png`)] }),
      { code: "22023" },
    );
    const ok = await sendMessage(alice, conv, null, { attachments: [attachment(`${conv}/${alice.id}/${randomUUID()}/a.png`)] });
    expect(ok.message_type).toBe("image");
  });

  it("records mentions of group members only", async () => {
    const [alice, bob, outsider] = await createUsers(3);
    const group = await createGroup(alice, [bob]);
    const msg = await sendMessage(alice, group, `hey @${bob.username} and @${outsider.username}`);
    const mentions = await asOwner("select user_id from public.message_mentions where message_id = $1", [msg.id]);
    expect(mentions.map((m) => m.user_id)).toEqual([bob.id]);
    const [row] = await asUser(bob.id, "select mention_count from public.get_conversations() where id = $1", [group]);
    expect(row.mention_count).toBe(1);
  });
});

describe("editing and deleting", () => {
  it("lets only the sender edit, within the edit window", async () => {
    const [alice, bob] = await createUsers(2);
    const conv = await directConversation(alice, bob);
    const msg = await sendMessage(alice, conv, "typo");
    await expectDbError(asUser(bob.id, "select public.edit_message($1, 'hijacked')", [msg.id]), { code: "42501" });
    const [edited] = await asUser(alice.id, "select content, edited_at from public.edit_message($1, 'fixed')", [msg.id]);
    expect(edited.content).toBe("fixed");
    expect(edited.edited_at).not.toBeNull();

    await asOwner("update public.messages set created_at = now() - interval '3 days' where id = $1", [msg.id]);
    await expectDbError(asUser(alice.id, "select public.edit_message($1, 'too late')", [msg.id]), { hint: "edit_window" });
  });

  it("deletes for everyone only by the sender (or a group admin) and removes content", async () => {
    const [alice, bob] = await createUsers(2);
    const conv = await directConversation(alice, bob);
    const msg = await sendMessage(alice, conv, "oops", {
      attachments: [
        { path: `${conv}/${alice.id}/${randomUUID()}/f.pdf`, kind: "file", file_name: "f.pdf", mime_type: "application/pdf", file_size: 5 },
      ],
    });
    await expectDbError(asUser(bob.id, "select public.delete_message($1, true)", [msg.id]), { code: "42501" });
    await asUser(alice.id, "select public.delete_message($1, true)", [msg.id]);
    const [row] = await asUser(bob.id, "select content, deleted_at, attachments from public.get_messages($1)", [conv]);
    expect(row.content).toBeNull();
    expect(row.deleted_at).not.toBeNull();
    expect(row.attachments).toEqual([]);
    const queued = await asOwner("select path from private.storage_deletion_queue where path like $1", [`${conv}/%`]);
    expect(queued).toHaveLength(1);
  });

  it("lets group admins moderate other members' messages", async () => {
    const [owner, member, other] = await createUsers(3);
    const group = await createGroup(owner, [member, other]);
    const msg = await sendMessage(member, group, "spam");
    await expectDbError(asUser(other.id, "select public.delete_message($1, true)", [msg.id]), { code: "42501" });
    await asUser(owner.id, "select public.delete_message($1, true)", [msg.id]);
    const [row] = await asOwner("select deleted_at from public.messages where id = $1", [msg.id]);
    expect(row.deleted_at).not.toBeNull();
  });

  it("deletes for me without affecting other members", async () => {
    const [alice, bob] = await createUsers(2);
    const conv = await directConversation(alice, bob);
    const msg = await sendMessage(alice, conv, "hide me");
    await asUser(bob.id, "select public.delete_message($1, false)", [msg.id]);
    expect(await asUser(bob.id, "select id from public.get_messages($1)", [conv])).toHaveLength(0);
    expect(await asUser(alice.id, "select id from public.get_messages($1)", [conv])).toHaveLength(1);
  });

  it("hides messages only the user can read", async () => {
    const [alice, bob, eve] = await createUsers(3);
    const conv = await directConversation(alice, bob);
    const msg = await sendMessage(alice, conv, "private");
    await expectDbError(
      asUser(eve.id, "insert into public.message_hidden (user_id, message_id) values ($1, $2)", [eve.id, msg.id]),
      { code: "42501" },
    );
  });
});

describe("reactions", () => {
  it("toggles reactions for members only", async () => {
    const [alice, bob, eve] = await createUsers(3);
    const conv = await directConversation(alice, bob);
    const msg = await sendMessage(alice, conv, "nice");

    const [added] = await asUser(bob.id, "select public.toggle_reaction($1, '👍') as added", [msg.id]);
    expect(added.added).toBe(true);
    const [details] = await asUser(alice.id, "select reactions from public.get_messages($1)", [conv]);
    expect(details.reactions).toHaveLength(1);

    const [removed] = await asUser(bob.id, "select public.toggle_reaction($1, '👍') as added", [msg.id]);
    expect(removed.added).toBe(false);
    const broadcasts = await asOwner(
      "select event, topic from realtime.messages where topic = $1 and event = 'reaction_removed'",
      [`conversation:${conv}`],
    );
    expect(broadcasts).toHaveLength(1);

    await expectDbError(asUser(eve.id, "select public.toggle_reaction($1, '👍')", [msg.id]), { code: "P0002" });
    await expectDbError(asUser(bob.id, "select public.toggle_reaction($1, 'not an emoji with spaces')", [msg.id]), {
      code: "22023",
    });
  });
});

describe("read state", () => {
  it("tracks unread counts and read receipts", async () => {
    const [alice, bob] = await createUsers(2);
    const conv = await directConversation(alice, bob);
    await sendMessage(alice, conv, "one");
    const second = await sendMessage(alice, conv, "two");

    const unread = async () =>
      (await asUser<{ unread_count: number }>(bob.id, "select unread_count from public.get_conversations() where id = $1", [conv]))[0]
        .unread_count;

    expect(await unread()).toBe(2);
    await asUser(bob.id, "select public.mark_delivered()");
    const [delivered] = await asUser(alice.id, "select last_delivered_at from public.conversation_members where conversation_id = $1 and user_id = $2", [
      conv,
      bob.id,
    ]);
    expect(delivered.last_delivered_at).not.toBeNull();

    await asUser(bob.id, "select public.mark_conversation_read($1, $2)", [conv, second.id]);
    expect(await unread()).toBe(0);
    const [receipt] = await asUser(alice.id, "select last_read_at from public.conversation_members where conversation_id = $1 and user_id = $2", [
      conv,
      bob.id,
    ]);
    expect(new Date(receipt.last_read_at).getTime()).toBe(new Date(second.created_at).getTime());
  });

  it("does not publish read receipts when the reader disabled them", async () => {
    const [alice, bob] = await createUsers(2);
    const conv = await directConversation(alice, bob);
    await asUser(bob.id, "update public.user_settings set read_receipts_enabled = false where user_id = $1", [bob.id]);
    await sendMessage(alice, conv, "seen?");
    await asUser(bob.id, "select public.mark_conversation_read($1)", [conv]);
    const [receipt] = await asUser(alice.id, "select last_read_at from public.conversation_members where conversation_id = $1 and user_id = $2", [
      conv,
      bob.id,
    ]);
    expect(receipt.last_read_at).toBeNull();
    const [state] = await asUser(bob.id, "select unread_count from public.get_conversations() where id = $1", [conv]);
    expect(state.unread_count).toBe(0);
  });

  it("keeps per-user preferences private and limited to safe columns", async () => {
    const [alice, bob] = await createUsers(2);
    const conv = await directConversation(alice, bob);
    expect(await asUser(alice.id, "select * from public.conversation_preferences where user_id = $1", [bob.id])).toHaveLength(0);
    await asUser(alice.id, "update public.conversation_preferences set archived_at = now() where conversation_id = $1", [conv]);
    const [bobPref] = await asOwner("select archived_at from public.conversation_preferences where conversation_id = $1 and user_id = $2", [
      conv,
      bob.id,
    ]);
    expect(bobPref.archived_at).toBeNull();
    await expectDbError(
      asUser(alice.id, "update public.conversation_preferences set last_read_at = now() where conversation_id = $1", [conv]),
      { code: "42501" },
    );
  });

  it("clears a direct chat from the list until a new message arrives", async () => {
    const [alice, bob] = await createUsers(2);
    const conv = await directConversation(alice, bob);
    await sendMessage(bob, conv, "old");
    await asUser(alice.id, "select public.clear_conversation($1)", [conv]);
    expect(await asUser(alice.id, "select id from public.get_conversations() where id = $1", [conv])).toHaveLength(0);
    expect(await asUser(alice.id, "select id from public.get_messages($1)", [conv])).toHaveLength(0);
    await sendMessage(bob, conv, "new");
    const messages = await asUser(alice.id, "select content from public.get_messages($1)", [conv]);
    expect(messages.map((m) => m.content)).toEqual(["new"]);
  });
});

describe("pagination", () => {
  it("returns stable, cursor-based pages newest first", async () => {
    const [alice, bob] = await createUsers(2);
    const conv = await directConversation(alice, bob);
    for (let i = 0; i < 7; i += 1) await sendMessage(alice, conv, `m${i}`);

    const page1 = await asUser(bob.id, "select id, content from public.get_messages($1, null, 3)", [conv]);
    expect(page1.map((m) => m.content)).toEqual(["m6", "m5", "m4"]);
    const last = page1[page1.length - 1];
    const page2 = await asUser(bob.id, "select id, content from public.get_messages($1, $2, 3)", [conv, last.id]);
    expect(page2.map((m) => m.content)).toEqual(["m3", "m2", "m1"]);
  });
});

describe("pins and reports", () => {
  it("lets any member pin in direct chats but only admins in groups", async () => {
    const [alice, bob, carol] = await createUsers(3);
    const conv = await directConversation(alice, bob);
    const msg = await sendMessage(alice, conv, "remember this");
    await asUser(bob.id, "select public.pin_message($1)", [msg.id]);
    expect(await asUser(alice.id, "select * from public.pinned_messages where conversation_id = $1", [conv])).toHaveLength(1);

    const group = await createGroup(alice, [bob, carol]);
    const gmsg = await sendMessage(carol, group, "group note");
    await expectDbError(asUser(carol.id, "select public.pin_message($1)", [gmsg.id]), { code: "42501" });
    await asUser(alice.id, "select public.pin_message($1)", [gmsg.id]);
    await asUser(alice.id, "select public.unpin_message($1)", [gmsg.id]);
  });

  it("files reports only about content the reporter can see", async () => {
    const [alice, bob, eve] = await createUsers(3);
    const conv = await directConversation(alice, bob);
    const msg = await sendMessage(bob, conv, "rude");
    await asUser(alice.id, "select public.report_content(null, $1, 'harassment', 'details')", [msg.id]);
    await expectDbError(asUser(eve.id, "select public.report_content(null, $1, 'spam', null)", [msg.id]), { code: "P0002" });
    expect(await asUser(bob.id, "select * from public.user_reports")).toHaveLength(0);
    expect(await asUser(alice.id, "select * from public.user_reports")).toHaveLength(1);
  });
});

describe("service-only functions", () => {
  it("are callable by the server role", async () => {
    const [allowed] = await asService<{ ok: boolean }>("select public.check_rate_limit($1, 2, 60) as ok", [`test:${randomUUID()}`]);
    expect(allowed.ok).toBe(true);
  });

  it("enforce the rate limit window", async () => {
    const key = `test:${randomUUID()}`;
    const results: boolean[] = [];
    for (let i = 0; i < 4; i += 1) {
      const [row] = await asService<{ ok: boolean }>("select public.check_rate_limit($1, 3, 60) as ok", [key]);
      results.push(row.ok);
    }
    expect(results).toEqual([true, true, true, false]);
  });

  it("are not callable by signed-in users", async () => {
    const user = await createUser();
    await expectDbError(asUser(user.id, "select public.check_rate_limit('x', 1, 1)"), { code: "42501" });
    await expectDbError(asUser(user.id, "select public.prepare_account_deletion($1)", [user.id]), { code: "42501" });
    await expectDbError(asUser(user.id, "select * from public.dequeue_storage_deletions(10)"), { code: "42501" });
  });
});
