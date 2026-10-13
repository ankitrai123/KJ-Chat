import { after } from "next/server";
import { z } from "zod";
import { AppError, fromDatabaseError } from "@/lib/errors";
import { isLiveKitConfigured } from "@/lib/env.server";
import { removeFromRoom } from "@/lib/livekit/server";
import { requireUser } from "@/lib/security/auth";
import { jsonError, jsonOk } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";

/**
 * Removes a member (admin rules enforced by remove_group_member()). Also ejects them from any
 * ongoing group call, since their LiveKit token would otherwise remain valid for that room.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ conversationId: string; userId: string }> }) {
  try {
    const { conversationId, userId: targetId } = await params;
    if (!z.uuid().safeParse(conversationId).success || !z.uuid().safeParse(targetId).success) {
      throw new AppError("invalid", "Invalid request.");
    }
    const { userId, supabase } = await requireUser(request);
    await enforceRateLimit("groupAdmin", userId);

    const { data: liveCalls } = await supabase.from("call_sessions").select("room_name").eq("conversation_id", conversationId).neq("status", "ended");

    const { error } = await supabase.rpc("remove_group_member", { p_conversation_id: conversationId, p_user_id: targetId });
    if (error) throw fromDatabaseError(error, "Could not remove this member.");

    if (isLiveKitConfigured() && liveCalls?.length) {
      after(() => Promise.all(liveCalls.map((c) => removeFromRoom(c.room_name, targetId))));
    }
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
