import { after } from "next/server";
import { z } from "zod";
import { issueTokenFor, publicCall } from "@/lib/calls/server";
import { AppError, fromDatabaseError } from "@/lib/errors";
import { assertLiveKitConfigured, closeRoom, muteParticipantAudio, removeFromRoom } from "@/lib/livekit/server";
import { requireUser } from "@/lib/security/auth";
import { jsonError, jsonOk, parseJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { moderateCallSchema } from "@/lib/validation/chat";

const ACTIONS = ["join", "decline", "leave", "moderate"] as const;
type Action = (typeof ACTIONS)[number];

/**
 * Call lifecycle actions for the signed-in user:
 *   join     → validates membership and call state, returns a LiveKit token
 *   decline  → declines a ringing invitation
 *   leave    → leaves (or cancels) the call; closes the room when the call ends
 *   moderate → caller / group admins can mute or remove a participant
 */
export async function POST(request: Request, { params }: { params: Promise<{ callId: string; action: string }> }) {
  try {
    const { callId, action } = await params;
    if (!z.uuid().safeParse(callId).success || !ACTIONS.includes(action as Action)) {
      throw new AppError("not_found", "Unknown call action.");
    }
    const { userId } = await requireUser(request);
    await enforceRateLimit(action === "join" ? "callToken" : "callAction", userId);
    const admin = getSupabaseAdminClient();

    switch (action as Action) {
      case "join": {
        assertLiveKitConfigured();
        const { data: call, error } = await admin.rpc("join_call", { p_user_id: userId, p_call_id: callId });
        if (error) throw fromDatabaseError(error, "Could not join the call.");
        if (call.status === "ended") throw new AppError("not_found", "This call has ended.", { status: 410, hint: "call_ended" });
        const { token, serverUrl } = await issueTokenFor(admin, call, userId);
        return jsonOk({ call: publicCall(call), token, serverUrl });
      }

      case "decline": {
        const { data: call, error } = await admin.rpc("decline_call", { p_user_id: userId, p_call_id: callId });
        if (error) throw fromDatabaseError(error, "Could not decline the call.");
        if (call.status === "ended") after(() => closeRoom(call.room_name));
        return jsonOk({ call: publicCall(call) });
      }

      case "leave": {
        const { data: call, error } = await admin.rpc("leave_call", { p_user_id: userId, p_call_id: callId });
        if (error) throw fromDatabaseError(error, "Could not leave the call.");
        // A 1:1 call ends for both sides when one leaves; disconnect the other client promptly.
        if (call.status === "ended") after(() => closeRoom(call.room_name));
        return jsonOk({ call: publicCall(call) });
      }

      case "moderate": {
        assertLiveKitConfigured();
        const input = await parseJson(request, moderateCallSchema);
        const { data: allowed, error } = await admin.rpc("can_moderate_call", { p_user_id: userId, p_call_id: callId });
        if (error) throw fromDatabaseError(error);
        if (!allowed) throw new AppError("forbidden", "Only the host or group admins can do that.");
        if (input.identity === userId) throw new AppError("invalid", "You can't moderate yourself.");

        const { data: session } = await admin.from("call_sessions").select("room_name").eq("id", callId).single();
        if (!session) throw new AppError("not_found", "Call not found.");

        if (input.action === "mute") {
          await muteParticipantAudio(session.room_name, input.identity, input.trackSid);
        } else {
          await admin.rpc("leave_call", { p_user_id: input.identity, p_call_id: callId });
          await removeFromRoom(session.room_name, input.identity);
        }
        return jsonOk({ ok: true });
      }
    }
  } catch (error) {
    return jsonError(error);
  }
}
