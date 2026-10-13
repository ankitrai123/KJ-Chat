import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  asOwner,
  asService,
  asUser,
  attachmentPath,
  createGroup,
  createUsers,
  directConversation,
  sendMessage,
  storeObject,
} from "./db/harness";

describe("account deletion", () => {
  it("tombstones messages, removes uploads, hands over groups, then cascades on auth deletion", async () => {
    const [leaver, friend, member] = await createUsers(3);
    const dm = await directConversation(leaver, friend);
    const group = await createGroup(leaver, [member]);
    const path = attachmentPath(dm, leaver, "photo.png");
    await storeObject(leaver, "attachments", path);
    await sendMessage(leaver, dm, "personal text", {
      attachments: [{ path, kind: "image", file_name: "photo.png", mime_type: "image/png", file_size: 1234 }],
    });
    await sendMessage(friend, dm, "friend's message");
    await asUser(leaver.id, "update public.profiles set avatar_path = $2 where id = $1", [leaver.id, `users/${leaver.id}/a.webp`]);

    await asService("select public.prepare_account_deletion($1)", [leaver.id]);

    // Their content is gone; the other person's message is untouched.
    const messages = await asUser<{ sender_id: string; content: string | null; deleted_at: string | null; message_type: string }>(
      friend.id,
      "select sender_id, content, deleted_at, message_type from public.get_messages($1) where message_type <> 'system'",
      [dm],
    );
    const theirs = messages.find((m) => m.sender_id === leaver.id)!;
    expect(theirs.content).toBeNull();
    expect(theirs.deleted_at).not.toBeNull();
    expect(messages.find((m) => m.sender_id === friend.id)?.content).toBe("friend's message");

    // Ownership moved to the remaining member before the account disappears.
    const [ownership] = await asOwner("select user_id from public.conversation_members where conversation_id = $1 and role = 'owner'", [group]);
    expect(ownership.user_id).toBe(member.id);

    // The Auth server then deletes the user; everything personal cascades.
    await asOwner("delete from auth.users where id = $1", [leaver.id]);
    expect(await asOwner("select id from public.profiles where id = $1", [leaver.id])).toHaveLength(0);
    expect(await asOwner("select 1 from public.conversation_members where user_id = $1", [leaver.id])).toHaveLength(0);

    // Upload and avatar are queued for storage removal.
    const queued = await asOwner<{ path: string }>("select path from private.storage_deletion_queue where path in ($1, $2)", [
      path,
      `users/${leaver.id}/a.webp`,
    ]);
    expect(queued.map((q) => q.path).sort()).toEqual([path, `users/${leaver.id}/a.webp`].sort());

    // The direct chat survives for the friend, now with a deleted peer.
    const [summary] = await asUser(friend.id, "select peer from public.get_conversations() where id = $1", [dm]);
    expect(summary.peer).toBeNull();
  });
});

describe("maintenance", () => {
  it("drains and re-queues storage deletions", async () => {
    const marker = `test/${randomUUID()}`;
    await asOwner("insert into private.storage_deletion_queue (bucket_id, path) values ('attachments', $1)", [marker]);
    const drained = await asService<{ path: string }>("select * from public.dequeue_storage_deletions(1000)");
    expect(drained.map((d) => d.path)).toContain(marker);
    expect(await asOwner("select 1 from private.storage_deletion_queue where path = $1", [marker])).toHaveLength(0);

    await asService("select public.requeue_storage_deletions($1::jsonb)", [JSON.stringify([{ bucket_id: "attachments", path: marker }])]);
    expect(await asOwner("select 1 from private.storage_deletion_queue where path = $1", [marker])).toHaveLength(1);
    await asService("select * from public.dequeue_storage_deletions(1000)");
  });

  it("expires stale ringing calls and removes conversations with no members", async () => {
    const [alice, bob] = await createUsers(2);
    const conv = await directConversation(alice, bob);
    const [{ result }] = await asService<{ result: { call: { id: string } } }>("select public.start_call($1, $2, 'audio') as result", [alice.id, conv]);
    await asOwner("update public.call_sessions set ring_expires_at = now() - interval '1 minute' where id = $1", [result.call.id]);

    const orphan = randomUUID();
    await asOwner("insert into public.conversations (id, type, direct_key) values ($1, 'direct', $2)", [orphan, `orphan:${orphan}`]);

    await asService("select public.run_maintenance()");
    const [call] = await asOwner("select status, end_reason from public.call_sessions where id = $1", [result.call.id]);
    expect(call).toEqual({ status: "ended", end_reason: "missed" });
    expect(await asOwner("select 1 from public.conversations where id = $1", [orphan])).toHaveLength(0);
  });

  it("lists uploads that were never attached", async () => {
    const [alice, bob] = await createUsers(2);
    const conv = await directConversation(alice, bob);
    const abandoned = attachmentPath(conv, alice, "draft.png");
    await storeObject(alice, "attachments", abandoned);
    await asOwner("update storage.objects set created_at = now() - interval '2 days' where name = $1", [abandoned]);
    const orphans = await asService<{ path: string }>("select * from public.list_orphan_uploads(24, 1000)");
    expect(orphans.map((o) => o.path)).toContain(abandoned);
  });
});
