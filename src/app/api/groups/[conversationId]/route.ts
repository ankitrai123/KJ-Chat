import { after } from "next/server";
import { z } from "zod";
import { AppError, fromDatabaseError } from "@/lib/errors";
import { isLiveKitConfigured } from "@/lib/env.server";
import { closeRoom } from "@/lib/livekit/server";
import { requireUser } from "@/lib/security/auth";
import { jsonError, jsonOk } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { processStorageDeletions } from "@/lib/storage/cleanup.server";

/** Deletes a group (owner only, enforced by delete_group()) and cleans up storage and calls. */
export async function DELETE(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await params;
    if (!z.uuid().safeParse(conversationId).success) throw new AppError("invalid", "Invalid group.");
    const { userId, supabase } = await requireUser(request);
    await enforceRateLimit("groupAdmin", userId);

    const { data: liveCalls } = await supabase.from("call_sessions").select("room_name").eq("conversation_id", conversationId).neq("status", "ended");

    const { error } = await supabase.rpc("delete_group", { p_conversation_id: conversationId });
    if (error) throw fromDatabaseError(error, "Could not delete the group.");

    after(async () => {
      const admin = getSupabaseAdminClient();
      await processStorageDeletions(admin, 1000).catch(() => undefined);
      if (isLiveKitConfigured()) await Promise.all((liveCalls ?? []).map((c) => closeRoom(c.room_name)));
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
