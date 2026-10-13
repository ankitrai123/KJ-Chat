import "server-only";

import { AppError, fromDatabaseError } from "@/lib/errors";
import { createJoinToken, liveKitClientUrl } from "@/lib/livekit/server";
import type { AdminSupabase } from "@/lib/supabase/admin";
import type { CallSessionRow } from "@/types/database";

export async function issueTokenFor(admin: AdminSupabase, call: CallSessionRow, userId: string) {
  const { data: profile, error } = await admin.from("profiles").select("display_name, avatar_path").eq("id", userId).single();
  if (error || !profile) throw fromDatabaseError(error, "Your profile could not be loaded.");
  const token = await createJoinToken({
    roomName: call.room_name,
    identity: userId,
    name: profile.display_name,
    metadata: { avatarPath: profile.avatar_path },
  });
  return { token, serverUrl: liveKitClientUrl() };
}

export function parseStartResult(value: unknown): { call: CallSessionRow; joinedExisting: boolean; busy: boolean } {
  if (!value || typeof value !== "object") throw new AppError("unknown", "Could not start the call.");
  const result = value as { call?: CallSessionRow; joined_existing?: boolean; busy?: boolean };
  if (!result.call?.id) throw new AppError("unknown", "Could not start the call.");
  return { call: result.call, joinedExisting: Boolean(result.joined_existing), busy: Boolean(result.busy) };
}

/** Public shape of a call returned to the browser (no room secrets beyond the room name). */
export function publicCall(call: CallSessionRow) {
  return {
    id: call.id,
    conversation_id: call.conversation_id,
    media_type: call.media_type,
    status: call.status,
    end_reason: call.end_reason,
    started_by: call.started_by,
    created_at: call.created_at,
    ring_expires_at: call.ring_expires_at,
    answered_at: call.answered_at,
  };
}
