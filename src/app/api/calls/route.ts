import { after } from "next/server";
import { issueTokenFor, parseStartResult, publicCall } from "@/lib/calls/server";
import { fromDatabaseError } from "@/lib/errors";
import { assertLiveKitConfigured } from "@/lib/livekit/server";
import { notifyIncomingCall } from "@/lib/notifications/push.server";
import { requireUser } from "@/lib/security/auth";
import { jsonError, jsonOk, parseJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { startCallSchema } from "@/lib/validation/chat";

/**
 * Starts (or joins the existing) call in a conversation and returns a LiveKit token for the
 * caller. Membership and block rules are enforced inside start_call().
 */
export async function POST(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const input = await parseJson(request, startCallSchema);
    assertLiveKitConfigured();
    await enforceRateLimit("callToken", userId);

    const admin = getSupabaseAdminClient();
    const { data, error } = await admin.rpc("start_call", {
      p_user_id: userId,
      p_conversation_id: input.conversationId,
      p_media_type: input.mediaType,
    });
    if (error) throw fromDatabaseError(error, "Could not start the call.");
    const { call, joinedExisting, busy } = parseStartResult(data);

    if (busy || call.status === "ended") {
      return jsonOk({ call: publicCall(call), busy: true, token: null, serverUrl: null, joinedExisting: false });
    }

    const { token, serverUrl } = await issueTokenFor(admin, call, userId);

    if (!joinedExisting) {
      after(async () => {
        try {
          const { data: invited } = await admin.from("call_participants").select("user_id").eq("call_id", call.id).eq("status", "invited");
          await notifyIncomingCall(admin, call, (invited ?? []).map((p) => p.user_id));
        } catch {
          // Push is best-effort; in-app ringing uses realtime.
        }
      });
    }

    return jsonOk({ call: publicCall(call), busy: false, token, serverUrl, joinedExisting }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
