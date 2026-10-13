import { describe, expect, it } from "vitest";
import { asOwner, asUser, createGroup, createUsers, expectDbError, sendMessage } from "./db/harness";

const roleOf = async (conversationId: string, userId: string) =>
  (await asOwner("select role from public.conversation_members where conversation_id = $1 and user_id = $2", [conversationId, userId]))[0]
    ?.role as string | undefined;

describe("group creation and membership", () => {
  it("makes the creator owner and members regular members", async () => {
    const [owner, a, b] = await createUsers(3);
    const group = await createGroup(owner, [a, b], "Book club");
    expect(await roleOf(group, owner.id)).toBe("owner");
    expect(await roleOf(group, a.id)).toBe("member");
    const [conv] = await asUser(a.id, "select type, name from public.conversations where id = $1", [group]);
    expect(conv).toMatchObject({ type: "group", name: "Book club" });
    const [system] = await asUser(a.id, "select metadata->>'event' as event from public.messages where conversation_id = $1", [group]);
    expect(system.event).toBe("group_created");
  });

  it("skips people who blocked the creator", async () => {
    const [owner, blocker] = await createUsers(2);
    await asUser(blocker.id, "insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)", [blocker.id, owner.id]);
    const group = await createGroup(owner, [blocker]);
    expect(await roleOf(group, blocker.id)).toBeUndefined();
  });

  it("lets only admins add or remove members", async () => {
    const [owner, member, newcomer] = await createUsers(3);
    const group = await createGroup(owner, [member]);
    await expectDbError(asUser(member.id, "select public.add_group_members($1, $2::uuid[])", [group, [newcomer.id]]), {
      code: "42501",
    });
    await expectDbError(asUser(newcomer.id, "select public.add_group_members($1, $2::uuid[])", [group, [newcomer.id]]), {
      code: "P0002",
    });
    await asUser(owner.id, "select public.add_group_members($1, $2::uuid[])", [group, [newcomer.id]]);
    expect(await roleOf(group, newcomer.id)).toBe("member");

    await expectDbError(asUser(member.id, "select public.remove_group_member($1, $2)", [group, newcomer.id]), { code: "42501" });
    await asUser(owner.id, "select public.remove_group_member($1, $2)", [group, newcomer.id]);
    expect(await roleOf(group, newcomer.id)).toBeUndefined();

    const notices = await asOwner("select event from realtime.messages where topic = $1", [`user:${newcomer.id}`]);
    expect(notices.map((n) => n.event)).toContain("membership_removed");
  });

  it("revokes access to history for removed members", async () => {
    const [owner, member] = await createUsers(2);
    const group = await createGroup(owner, [member]);
    await sendMessage(owner, group, "before removal");
    await asUser(owner.id, "select public.remove_group_member($1, $2)", [group, member.id]);
    expect(await asUser(member.id, "select * from public.messages where conversation_id = $1", [group])).toHaveLength(0);
    await expectDbError(sendMessage(member, group, "still here?"), { code: "P0002" });
  });

  it("protects owners and admins from lower roles", async () => {
    const [owner, admin, admin2, member] = await createUsers(4);
    const group = await createGroup(owner, [admin, admin2, member]);
    await asUser(owner.id, "select public.set_group_member_role($1, $2, 'admin')", [group, admin.id]);
    await asUser(admin.id, "select public.set_group_member_role($1, $2, 'admin')", [group, admin2.id]);

    await expectDbError(asUser(admin.id, "select public.remove_group_member($1, $2)", [group, owner.id]), { code: "42501" });
    await expectDbError(asUser(admin.id, "select public.remove_group_member($1, $2)", [group, admin2.id]), { code: "42501" });
    await expectDbError(asUser(admin.id, "select public.set_group_member_role($1, $2, 'member')", [group, admin2.id]), {
      code: "42501",
    });
    await expectDbError(asUser(admin.id, "select public.set_group_member_role($1, $2, 'owner')", [group, admin.id]), {
      code: "42501",
    });
    await expectDbError(asUser(member.id, "select public.set_group_member_role($1, $2, 'admin')", [group, member.id]), {
      code: "42501",
    });

    await asUser(admin.id, "select public.remove_group_member($1, $2)", [group, member.id]);
    await asUser(owner.id, "select public.set_group_member_role($1, $2, 'member')", [group, admin2.id]);
    expect(await roleOf(group, admin2.id)).toBe("member");
  });

  it("transfers ownership explicitly and on leave", async () => {
    const [owner, next, member] = await createUsers(3);
    const group = await createGroup(owner, [next, member]);
    await asUser(owner.id, "select public.set_group_member_role($1, $2, 'owner')", [group, next.id]);
    expect(await roleOf(group, next.id)).toBe("owner");
    expect(await roleOf(group, owner.id)).toBe("admin");

    await asUser(next.id, "select public.leave_group($1)", [group]);
    expect(await roleOf(group, next.id)).toBeUndefined();
    // The remaining admin inherits ownership before plain members.
    expect(await roleOf(group, owner.id)).toBe("owner");
  });

  it("deletes the group when the last member leaves", async () => {
    const [owner] = await createUsers(1);
    const group = await createGroup(owner, []);
    await asUser(owner.id, "select public.leave_group($1)", [group]);
    expect(await asOwner("select id from public.conversations where id = $1", [group])).toHaveLength(0);
  });

  it("only lets the owner delete a group", async () => {
    const [owner, admin] = await createUsers(2);
    const group = await createGroup(owner, [admin]);
    await asUser(owner.id, "select public.set_group_member_role($1, $2, 'admin')", [group, admin.id]);
    await expectDbError(asUser(admin.id, "select public.delete_group($1)", [group]), { code: "42501" });
    await asUser(owner.id, "select public.delete_group($1)", [group]);
    expect(await asOwner("select id from public.conversations where id = $1", [group])).toHaveLength(0);
  });

  it("lets admins edit group info but not members", async () => {
    const [owner, member] = await createUsers(2);
    const group = await createGroup(owner, [member]);
    await expectDbError(asUser(member.id, "select public.update_group($1, 'Hijacked', null)", [group]), { code: "42501" });
    await asUser(owner.id, "select public.update_group($1, 'Renamed', 'desc')", [group]);
    const [conv] = await asUser(member.id, "select name, description from public.conversations where id = $1", [group]);
    expect(conv).toEqual({ name: "Renamed", description: "desc" });
    await expectDbError(asUser(owner.id, "select public.set_group_avatar($1, 'groups/elsewhere/a.png')", [group]), {
      code: "23514",
    });
    await asUser(owner.id, "select public.set_group_avatar($1, $2)", [group, `groups/${group}/a.webp`]);
  });
});

describe("group invite links", () => {
  it("are managed by admins and joinable while valid", async () => {
    const [owner, member, joiner, late] = await createUsers(4);
    const group = await createGroup(owner, [member]);
    await expectDbError(asUser(member.id, "select public.create_group_invite($1, 24, 1)", [group]), { code: "42501" });
    const [invite] = await asUser<{ id: string; token: string }>(owner.id, "select id, token from public.create_group_invite($1, 24, 1)", [
      group,
    ]);

    expect(await asUser(member.id, "select * from public.group_invites where conversation_id = $1", [group])).toHaveLength(0);
    const [preview] = await asUser(joiner.id, "select name, is_member from public.get_group_invite_preview($1)", [invite.token]);
    expect(preview).toMatchObject({ name: "Test group", is_member: false });

    const [joined] = await asUser<{ id: string }>(joiner.id, "select public.join_group_via_invite($1) as id", [invite.token]);
    expect(joined.id).toBe(group);
    expect(await roleOf(group, joiner.id)).toBe("member");

    // max_uses = 1
    await expectDbError(asUser(late.id, "select public.join_group_via_invite($1)", [invite.token]), { hint: "invite_invalid" });
    expect(await asUser(late.id, "select * from public.get_group_invite_preview($1)", [invite.token])).toHaveLength(0);
  });

  it("stop working when revoked or expired", async () => {
    const [owner, joiner] = await createUsers(2);
    const group = await createGroup(owner, []);
    const [revoked] = await asUser<{ id: string; token: string }>(owner.id, "select id, token from public.create_group_invite($1, 24, null)", [
      group,
    ]);
    await asUser(owner.id, "select public.revoke_group_invite($1)", [revoked.id]);
    await expectDbError(asUser(joiner.id, "select public.join_group_via_invite($1)", [revoked.token]), { hint: "invite_invalid" });

    const [expired] = await asUser<{ id: string; token: string }>(owner.id, "select id, token from public.create_group_invite($1, 1, null)", [
      group,
    ]);
    await asOwner("update public.group_invites set expires_at = now() - interval '1 minute' where id = $1", [expired.id]);
    await expectDbError(asUser(joiner.id, "select public.join_group_via_invite($1)", [expired.token]), { hint: "invite_invalid" });

    await expectDbError(asUser(joiner.id, "select public.join_group_via_invite('made-up-token')"), { hint: "invite_invalid" });
    expect(await roleOf(group, joiner.id)).toBeUndefined();
  });

  it("cannot be created with unbounded lifetime", async () => {
    const [owner] = await createUsers(1);
    const group = await createGroup(owner, []);
    await expectDbError(asUser(owner.id, "select public.create_group_invite($1, 100000, null)", [group]), { code: "22023" });
  });
});
