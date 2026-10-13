import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  asAnon,
  asOwner,
  asUser,
  createUser,
  directConversation,
  expectDbError,
  pool,
} from "./db/harness";

describe("signup trigger", () => {
  it("creates a profile, settings and last-seen row for every new auth user", async () => {
    const user = await createUser({ displayName: "Ada Lovelace" });
    const [profile] = await asUser(user.id, "select display_name, username from public.profiles where id = $1", [user.id]);
    expect(profile.display_name).toBe("Ada Lovelace");
    const [settings] = await asUser(user.id, "select read_receipts_enabled from public.user_settings where user_id = $1", [
      user.id,
    ]);
    expect(settings.read_receipts_enabled).toBe(true);
  });

  it("enforces invite-only registration in the database", async () => {
    const admin = await createUser();
    await asOwner("insert into public.app_admins (user_id) values ($1) on conflict do nothing", [admin.id]);
    const [invite] = await asUser<{ code: string }>(
      admin.id,
      "select code from public.admin_create_app_invitation(null, 'friend', 24, 1)",
    );

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("update public.app_settings set registration_mode = 'invite'");
      await client.query("set local role supabase_auth_admin");

      // No code
      await client.query("savepoint s1");
      await expect(
        client.query("insert into auth.users (id, email) values ($1, $2)", [randomUUID(), "nocode@test.local"]),
      ).rejects.toMatchObject({ hint: "invite_required" });
      await client.query("rollback to savepoint s1");

      // Wrong code
      await expect(
        client.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
          randomUUID(),
          "badcode@test.local",
          { invite_code: "nope" },
        ]),
      ).rejects.toMatchObject({ hint: "invite_invalid" });
      await client.query("rollback to savepoint s1");

      // Valid code works exactly once
      await client.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
        randomUUID(),
        "invited@test.local",
        { invite_code: invite.code },
      ]);
      await client.query("savepoint s2");
      await expect(
        client.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
          randomUUID(),
          "reuse@test.local",
          { invite_code: invite.code },
        ]),
      ).rejects.toMatchObject({ hint: "invite_invalid" });
      await client.query("rollback to savepoint s2");

      // Accounts created by an administrator through the Admin API bypass invites.
      await client.query("insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, $3)", [
        randomUUID(),
        "admin-created@test.local",
        { kj_admin_created: true },
      ]);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("restricts invitations to their email when one is set", async () => {
    const admin = await createUser();
    await asOwner("insert into public.app_admins (user_id) values ($1) on conflict do nothing", [admin.id]);
    const [invite] = await asUser<{ code: string }>(
      admin.id,
      "select code from public.admin_create_app_invitation('Only@Test.local', null, 24, 1)",
    );
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("update public.app_settings set registration_mode = 'invite'");
      await client.query("set local role supabase_auth_admin");
      await client.query("savepoint s");
      await expect(
        client.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
          randomUUID(),
          "someone-else@test.local",
          { invite_code: invite.code },
        ]),
      ).rejects.toMatchObject({ hint: "invite_invalid" });
      await client.query("rollback to savepoint s");
      await client.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
        randomUUID(),
        "only@test.local",
        { invite_code: invite.code },
      ]);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("only lets administrators manage invitations and registration mode", async () => {
    const user = await createUser();
    await expectDbError(asUser(user.id, "select public.admin_create_app_invitation(null, null, 24, 1)"), { code: "42501" });
    await expectDbError(asUser(user.id, "select public.admin_set_registration_mode('open')"), { code: "42501" });
    const rows = await asUser(user.id, "select * from public.app_invitations");
    expect(rows).toHaveLength(0);
  });

  it("exposes only the registration mode and invite validation to anonymous visitors", async () => {
    const [mode] = await asAnon<{ mode: string }>("select public.get_registration_mode() as mode");
    expect(["open", "invite"]).toContain(mode.mode);
    await expectDbError(asAnon("select * from public.profiles"), { code: "42501" });
    await expectDbError(asAnon("select * from public.messages"), { code: "42501" });
    await expectDbError(asAnon("select public.get_conversations()"), { code: "42501" });
  });
});

describe("profiles", () => {
  it("lets users update only their own profile", async () => {
    const alice = await createUser();
    const bob = await createUser();
    await asUser(alice.id, "update public.profiles set bio = 'hi' where id = $1", [alice.id]);
    await asUser(alice.id, "update public.profiles set bio = 'hacked' where id = $1", [bob.id]);
    const [bobProfile] = await asOwner("select bio from public.profiles where id = $1", [bob.id]);
    expect(bobProfile.bio).toBeNull();
  });

  it("does not allow changing protected columns", async () => {
    const alice = await createUser();
    await expectDbError(
      asUser(alice.id, "update public.profiles set created_at = now() - interval '1 year' where id = $1", [alice.id]),
      { code: "42501" },
    );
    await expectDbError(asUser(alice.id, "update public.profiles set id = gen_random_uuid() where id = $1", [alice.id]), {
      code: "42501",
    });
  });

  it("enforces username format and uniqueness", async () => {
    const alice = await createUser();
    const bob = await createUser();
    await expectDbError(asUser(alice.id, "update public.profiles set username = 'Has Spaces' where id = $1", [alice.id]), {
      code: "23514",
    });
    await expectDbError(asUser(alice.id, "update public.profiles set username = $2 where id = $1", [alice.id, bob.username]), {
      code: "23505",
    });
    const [available] = await asUser<{ ok: boolean }>(alice.id, "select public.is_username_available($1) as ok", [
      bob.username,
    ]);
    expect(available.ok).toBe(false);
  });

  it("only allows avatars inside the user's own folder", async () => {
    const alice = await createUser();
    const bob = await createUser();
    await asUser(alice.id, "update public.profiles set avatar_path = $2 where id = $1", [alice.id, `users/${alice.id}/a.webp`]);
    await expectDbError(
      asUser(alice.id, "update public.profiles set avatar_path = $2 where id = $1", [alice.id, `users/${bob.id}/a.webp`]),
      { code: "23514" },
    );
  });

  it("keeps settings private to their owner", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const rows = await asUser(alice.id, "select * from public.user_settings where user_id = $1", [bob.id]);
    expect(rows).toHaveLength(0);
    await asUser(alice.id, "update public.user_settings set read_receipts_enabled = false where user_id = $1", [bob.id]);
    const [bobSettings] = await asOwner("select read_receipts_enabled from public.user_settings where user_id = $1", [bob.id]);
    expect(bobSettings.read_receipts_enabled).toBe(true);
  });

  it("applies last-seen privacy rules", async () => {
    const alice = await createUser();
    const contact = await createUser();
    const stranger = await createUser();
    await directConversation(alice, contact);

    const visibleTo = async (viewer: { id: string }) =>
      (await asUser(viewer.id, "select 1 from public.user_last_seen where user_id = $1", [alice.id])).length === 1;

    expect(await visibleTo(contact)).toBe(true);
    expect(await visibleTo(stranger)).toBe(true);

    await asUser(alice.id, "update public.user_settings set last_seen_visibility = 'contacts' where user_id = $1", [alice.id]);
    expect(await visibleTo(contact)).toBe(true);
    expect(await visibleTo(stranger)).toBe(false);

    await asUser(alice.id, "update public.user_settings set last_seen_visibility = 'nobody' where user_id = $1", [alice.id]);
    expect(await visibleTo(contact)).toBe(false);
    expect(await visibleTo(alice)).toBe(true);

    await asUser(alice.id, "update public.user_settings set last_seen_visibility = 'everyone' where user_id = $1", [alice.id]);
    await asUser(alice.id, "insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)", [alice.id, stranger.id]);
    expect(await visibleTo(stranger)).toBe(false);
  });

  it("hides users who blocked you from search, and blocks are private", async () => {
    const alice = await createUser({ displayName: "Searchable Alice" });
    const bob = await createUser();
    const found = await asUser(bob.id, "select id from public.search_profiles($1)", [alice.username]);
    expect(found.map((r) => r.id)).toContain(alice.id);

    await asUser(alice.id, "insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)", [alice.id, bob.id]);
    const hidden = await asUser(bob.id, "select id from public.search_profiles($1)", [alice.username]);
    expect(hidden.map((r) => r.id)).not.toContain(alice.id);

    const visibleBlocks = await asUser(bob.id, "select * from public.user_blocks");
    expect(visibleBlocks).toHaveLength(0);

    await expectDbError(
      asUser(bob.id, "insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)", [alice.id, bob.id]),
      { code: "42501" },
    );
  });
});
