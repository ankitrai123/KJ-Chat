import { after } from "next/server";
import { z } from "zod";
import { AppError, fromDatabaseError } from "@/lib/errors";
import { requireUser } from "@/lib/security/auth";
import { jsonError, jsonOk } from "@/lib/security/http";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { processStorageDeletions } from "@/lib/storage/cleanup.server";

/** Deletes a message for everyone, then removes its files from storage right away. */
export async function DELETE(request: Request, { params }: { params: Promise<{ messageId: string }> }) {
  try {
    const { supabase } = await requireUser(request);
    const { messageId } = await params;
    if (!z.uuid().safeParse(messageId).success) throw new AppError("invalid", "Invalid message.");

    // Runs as the user: delete_message() enforces sender / group-admin rules.
    const { error } = await supabase.rpc("delete_message", { p_message_id: messageId, p_for_everyone: true });
    if (error) throw fromDatabaseError(error, "Could not delete the message.");

    after(async () => {
      try {
        await processStorageDeletions(getSupabaseAdminClient(), 50);
      } catch {
        // The maintenance job retries anything left in the queue.
      }
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
