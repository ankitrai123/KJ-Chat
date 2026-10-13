import { describe, expect, it } from "vitest";
import { asOwner, createGroup, createUsers, directConversation, expectDbError, realtimeAs } from "./db/harness";

const canReceive = async (userId: string, topic: string) =>
  (await realtimeAs(userId, topic, "select private.can_access_realtime_topic(realtime.topic(), false) as ok"))[0].ok as boolean;

const publish = (userId: string, topic: string, extension = "broadcast") =>
  realtimeAs(
    userId,
    topic,
    "insert into realtime.messages (topic, extension, event, payload, private) values ($1, $2, 'typing', '{}', true)",
    [topic, extension],
  );

describe("realtime channel authorisation", () => {
  it("limits conversation topics to members", async () => {
    const [alice, bob, eve] = await createUsers(3);
    const conv = await directConversation(alice, bob);
    expect(await canReceive(alice.id, `conversation:${conv}`)).toBe(true);
    expect(await canReceive(eve.id, `conversation:${conv}`)).toBe(false);
    await publish(alice.id, `conversation:${conv}`);
    await expectDbError(publish(eve.id, `conversation:${conv}`), { code: "42501" });
  });

  it("keeps personal topics private and server-published", async () => {
    const [alice, bob] = await createUsers(2);
    expect(await canReceive(alice.id, `user:${alice.id}`)).toBe(true);
    expect(await canReceive(bob.id, `user:${alice.id}`)).toBe(false);
    await expectDbError(publish(alice.id, `user:${alice.id}`), { code: "42501" });
  });

  it("allows presence on the shared online topic and rejects unknown topics", async () => {
    const [alice] = await createUsers(1);
    await publish(alice.id, "online", "presence");
    expect(await canReceive(alice.id, "something-else")).toBe(false);
    expect(await canReceive(alice.id, "conversation:not-a-uuid")).toBe(false);
  });

  it("updates group topic access as membership changes", async () => {
    const [owner, member] = await createUsers(2);
    const group = await createGroup(owner, [member]);
    expect(await canReceive(member.id, `conversation:${group}`)).toBe(true);
    await asOwner("delete from public.conversation_members where conversation_id = $1 and user_id = $2", [group, member.id]);
    expect(await canReceive(member.id, `conversation:${group}`)).toBe(false);
  });
});

/**
 * Guards against accidental exposure: any new function or table must be consciously added
 * to these lists (and to 20261013120900_privileges.sql).
 */
describe("privilege audit", () => {
  const ANON_FUNCTIONS = ["get_registration_mode", "validate_app_invite"].sort();

  const SERVICE_ONLY_FUNCTIONS = [
    "can_moderate_call",
    "check_rate_limit",
    "decline_call",
    "dequeue_storage_deletions",
    "join_call",
    "leave_call",
    "list_orphan_uploads",
    "livekit_participant_left",
    "livekit_room_finished",
    "prepare_account_deletion",
    "requeue_storage_deletions",
    "run_maintenance",
    "send_message",
    "start_call",
  ].sort();

  it("exposes only the intended functions to anonymous visitors", async () => {
    const rows = await asOwner<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`,
    );
    expect(rows.map((r) => r.proname)).toEqual(ANON_FUNCTIONS);
  });

  it("never lets signed-in users call service-only functions", async () => {
    const rows = await asOwner<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and not has_function_privilege('authenticated', p.oid, 'execute') order by 1`,
    );
    expect(rows.map((r) => r.proname)).toEqual(SERVICE_ONLY_FUNCTIONS);
  });

  it("does not expose internal helper functions with user-id parameters", async () => {
    const rows = await asOwner<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'execute') order by 1`,
    );
    expect(rows.map((r) => r.proname)).toEqual(
      [
        "can_access_realtime_topic",
        "can_read_attachment",
        "can_read_avatar",
        "can_see_last_seen",
        "can_upload_attachment",
        "can_write_avatar",
        "escape_like",
        "is_app_admin",
        "is_attachment_referenced",
        "is_group_admin",
        "is_member",
        "try_uuid",
      ].sort(),
    );
  });

  it("enables RLS on every public table and grants nothing to anon", async () => {
    const noRls = await asOwner(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(noRls).toEqual([]);

    const anonGrants = await asOwner(
      `select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'anon' and table_schema = 'public'`,
    );
    expect(anonGrants).toEqual([]);
  });

  it("does not grant direct writes on shared tables to signed-in users", async () => {
    const rows = await asOwner<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('INSERT', 'DELETE', 'TRUNCATE')
       order by 1, 2`,
    );
    expect(rows.map((r) => `${r.table_name}:${r.privilege_type}`)).toEqual([
      "message_hidden:DELETE",
      "message_hidden:INSERT",
      "push_subscriptions:DELETE",
      "user_blocks:DELETE",
      "user_blocks:INSERT",
    ]);
  });
});
