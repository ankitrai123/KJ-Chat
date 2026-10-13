import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  asUser,
  attachmentPath,
  createGroup,
  createUsers,
  directConversation,
  expectDbError,
  sendMessage,
  storeObject,
} from "./db/harness";

const readable = async (userId: string, bucket: string, name: string) =>
  (await asUser(userId, "select id from storage.objects where bucket_id = $1 and name = $2", [bucket, name])).length === 1;

describe("attachments bucket", () => {
  it("allows uploads only into the uploader's folder of a conversation they belong to", async () => {
    const [alice, bob, eve] = await createUsers(3);
    const conv = await directConversation(alice, bob);

    await storeObject(alice, "attachments", attachmentPath(conv, alice));
    await expectDbError(storeObject(alice, "attachments", attachmentPath(conv, bob)), { code: "42501" });
    await expectDbError(storeObject(eve, "attachments", attachmentPath(conv, eve)), { code: "42501" });
    await expectDbError(storeObject(alice, "attachments", `${conv}/${alice.id}/photo.png`), { code: "42501" });
    await expectDbError(storeObject(alice, "attachments", `not-a-uuid/${alice.id}/${randomUUID()}/a.png`), { code: "42501" });
  });

  it("blocks uploads into a direct chat with a blocked user", async () => {
    const [alice, bob] = await createUsers(2);
    const conv = await directConversation(alice, bob);
    await asUser(bob.id, "insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)", [bob.id, alice.id]);
    await expectDbError(storeObject(alice, "attachments", attachmentPath(conv, alice)), { code: "42501" });
  });

  it("keeps unattached uploads private to the uploader, then shares them with members only", async () => {
    const [alice, bob, eve] = await createUsers(3);
    const conv = await directConversation(alice, bob);
    const path = attachmentPath(conv, alice, "secret.pdf");
    await storeObject(alice, "attachments", path, 2048, "application/pdf");

    expect(await readable(alice.id, "attachments", path)).toBe(true);
    expect(await readable(bob.id, "attachments", path)).toBe(false);

    await sendMessage(alice, conv, null, {
      attachments: [{ path, kind: "file", file_name: "secret.pdf", mime_type: "application/pdf", file_size: 2048 }],
    });

    expect(await readable(bob.id, "attachments", path)).toBe(true);
    expect(await readable(eve.id, "attachments", path)).toBe(false);
  });

  it("revokes access when the message is deleted or the member leaves", async () => {
    const [owner, member] = await createUsers(2);
    const group = await createGroup(owner, [member]);
    const path = attachmentPath(group, owner);
    await storeObject(owner, "attachments", path);
    const msg = await sendMessage(owner, group, null, {
      attachments: [{ path, kind: "image", file_name: "p.png", mime_type: "image/png", file_size: 1234 }],
    });
    expect(await readable(member.id, "attachments", path)).toBe(true);

    await asUser(member.id, "select public.leave_group($1)", [group]);
    expect(await readable(member.id, "attachments", path)).toBe(false);

    await asUser(owner.id, "select public.delete_message($1, true)", [msg.id]);
    // The uploader still sees the raw object until the server's cleanup job removes it.
    expect(await readable(owner.id, "attachments", path)).toBe(true);
  });

  it("only lets the uploader delete objects that are not attached to a message", async () => {
    const [alice, bob] = await createUsers(2);
    const conv = await directConversation(alice, bob);
    const draft = attachmentPath(conv, alice);
    const sent = attachmentPath(conv, alice);
    await storeObject(alice, "attachments", draft);
    await storeObject(alice, "attachments", sent);
    await sendMessage(alice, conv, null, {
      attachments: [{ path: sent, kind: "image", file_name: "p.png", mime_type: "image/png", file_size: 1234 }],
    });

    const del = (userId: string, name: string) =>
      asUser(userId, "delete from storage.objects where bucket_id = 'attachments' and name = $1 returning id", [name]);

    expect(await del(bob.id, draft)).toHaveLength(0);
    expect(await del(alice.id, sent)).toHaveLength(0);
    expect(await del(alice.id, draft)).toHaveLength(1);
  });
});

describe("avatars bucket", () => {
  it("lets users manage only their own avatar folder, readable by everyone signed in", async () => {
    const [alice, bob] = await createUsers(2);
    const own = `users/${alice.id}/${randomUUID()}.webp`;
    await storeObject(alice, "avatars", own, 100, "image/webp");
    await expectDbError(storeObject(alice, "avatars", `users/${bob.id}/x.webp`), { code: "42501" });
    expect(await readable(bob.id, "avatars", own)).toBe(true);
    expect(
      await asUser(bob.id, "delete from storage.objects where bucket_id = 'avatars' and name = $1 returning id", [own]),
    ).toHaveLength(0);
  });

  it("restricts group avatars to admins (write) and members (read)", async () => {
    const [owner, member, outsider] = await createUsers(3);
    const group = await createGroup(owner, [member]);
    const name = `groups/${group}/${randomUUID()}.webp`;
    await expectDbError(storeObject(member, "avatars", name), { code: "42501" });
    await storeObject(owner, "avatars", name, 100, "image/webp");
    expect(await readable(member.id, "avatars", name)).toBe(true);
    expect(await readable(outsider.id, "avatars", name)).toBe(false);
  });
});
