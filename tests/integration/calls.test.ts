import { describe, expect, it } from "vitest";
import {
  asOwner,
  asService,
  asUser,
  createGroup,
  createUsers,
  directConversation,
  expectDbError,
  type TestUser,
} from "./db/harness";

interface StartResult {
  call: { id: string; status: string; room_name: string; end_reason: string | null };
  joined_existing: boolean;
  busy: boolean;
}

const start = async (user: TestUser, conversationId: string, media: "audio" | "video" = "video") =>
  (await asService<{ result: StartResult }>("select public.start_call($1, $2, $3) as result", [user.id, conversationId, media]))[0]
    .result;

const join = (user: TestUser, callId: string) => asService("select * from public.join_call($1, $2)", [user.id, callId]);
const leave = (user: TestUser, callId: string) => asService("select * from public.leave_call($1, $2)", [user.id, callId]);
const decline = (user: TestUser, callId: string) => asService("select * from public.decline_call($1, $2)", [user.id, callId]);
const statusOf = async (callId: string) =>
  (await asOwner("select status, end_reason from public.call_sessions where id = $1", [callId]))[0] as {
    status: string;
    end_reason: string | null;
  };

describe("call lifecycle", () => {
  it("cannot be driven by end users directly", async () => {
    const [alice, bob] = await createUsers(2);
    const conv = await directConversation(alice, bob);
    await expectDbError(asUser(alice.id, "select public.start_call($1, $2, 'audio')", [bob.id, conv]), { code: "42501" });
  });

  it("rings, connects and ends a direct call with a call log entry", async () => {
    const [alice, bob] = await createUsers(2);
    const conv = await directConversation(alice, bob);
    const { call } = await start(alice, conv, "audio");
    expect(call.status).toBe("ringing");
    expect(call.room_name).toMatch(/^call_[0-9a-f]{32}$/);

    const [invite] = await asUser(bob.id, "select status from public.call_participants where call_id = $1 and user_id = $2", [
      call.id,
      bob.id,
    ]);
    expect(invite.status).toBe("invited");

    const [active] = await join(bob, call.id);
    expect(active.status).toBe("active");

    await leave(bob, call.id);
    expect(await statusOf(call.id)).toEqual({ status: "ended", end_reason: "completed" });

    const [log] = await asUser(alice.id, "select message_type, metadata from public.messages where conversation_id = $1", [conv]);
    expect(log.message_type).toBe("call");
    expect(log.metadata.end_reason).toBe("completed");
  });

  it("refuses non-members", async () => {
    const [alice, bob, eve] = await createUsers(3);
    const conv = await directConversation(alice, bob);
    const { call } = await start(alice, conv);
    await expectDbError(join(eve, call.id), { code: "P0002" });
    await expectDbError(start(eve, conv), { code: "P0002" });
    expect(await asUser(eve.id, "select * from public.call_sessions where id = $1", [call.id])).toHaveLength(0);
  });

  it("handles decline, cancel and missed calls", async () => {
    const [alice, bob] = await createUsers(2);
    const conv = await directConversation(alice, bob);

    const declined = (await start(alice, conv)).call;
    await decline(bob, declined.id);
    expect(await statusOf(declined.id)).toEqual({ status: "ended", end_reason: "declined" });
    const [afterDecline] = await join(bob, declined.id);
    expect(afterDecline.status).toBe("ended");

    const cancelled = (await start(alice, conv)).call;
    await leave(alice, cancelled.id);
    expect(await statusOf(cancelled.id)).toEqual({ status: "ended", end_reason: "cancelled" });

    const missed = (await start(alice, conv)).call;
    await asOwner("update public.call_sessions set ring_expires_at = now() - interval '1 second' where id = $1", [missed.id]);
    const [afterExpiry] = await join(bob, missed.id);
    expect(afterExpiry.status).toBe("ended");
    expect(await statusOf(missed.id)).toEqual({ status: "ended", end_reason: "missed" });
  });

  it("reports busy when the callee is already in another call", async () => {
    const [alice, bob, carol] = await createUsers(3);
    const ab = await directConversation(alice, bob);
    const cb = await directConversation(carol, bob);
    const first = (await start(alice, ab)).call;
    await join(bob, first.id);

    const second = await start(carol, cb);
    expect(second.busy).toBe(true);
    expect(await statusOf(second.call.id)).toEqual({ status: "ended", end_reason: "busy" });
  });

  it("joins the existing call when both sides call at once", async () => {
    const [alice, bob] = await createUsers(2);
    const conv = await directConversation(alice, bob);
    const first = await start(alice, conv);
    const second = await start(bob, conv);
    expect(second.joined_existing).toBe(true);
    expect(second.call.id).toBe(first.call.id);
    expect(second.call.status).toBe("active");
  });

  it("keeps a group call alive until the last participant leaves", async () => {
    const [owner, a, b] = await createUsers(3);
    const group = await createGroup(owner, [a, b]);
    const { call } = await start(owner, group);
    await join(a, call.id);
    await join(b, call.id);
    await leave(owner, call.id);
    expect((await statusOf(call.id)).status).toBe("active");
    await leave(a, call.id);
    await leave(b, call.id);
    expect(await statusOf(call.id)).toEqual({ status: "ended", end_reason: "completed" });
  });

  it("lets only the caller or group admins moderate", async () => {
    const [owner, a, b] = await createUsers(3);
    const group = await createGroup(owner, [a, b]);
    const { call } = await start(a, group);
    const can = async (u: TestUser) =>
      (await asService<{ ok: boolean }>("select public.can_moderate_call($1, $2) as ok", [u.id, call.id]))[0].ok;
    expect(await can(a)).toBe(true);
    expect(await can(owner)).toBe(true);
    expect(await can(b)).toBe(false);
  });

  it("is reconciled by LiveKit webhooks", async () => {
    const [alice, bob] = await createUsers(2);
    const conv = await directConversation(alice, bob);
    const { call } = await start(alice, conv);
    await join(bob, call.id);
    await asService("select public.livekit_participant_left($1, $2)", [call.room_name, bob.id]);
    expect(await statusOf(call.id)).toEqual({ status: "ended", end_reason: "completed" });

    const other = (await start(alice, conv)).call;
    await asService("select public.livekit_room_finished($1)", [other.room_name]);
    expect((await statusOf(other.id)).status).toBe("ended");
  });
});
