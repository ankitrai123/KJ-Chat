import { AppError, fromDatabaseError } from "@/lib/errors";
import { requireUser } from "@/lib/security/auth";
import { jsonError, jsonOk, parseJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { processStorageDeletions } from "@/lib/storage/cleanup.server";
import { deleteAccountSchema } from "@/lib/validation/chat";

/**
 * Permanently deletes the signed-in user's account.
 *
 * Retention (documented in README): the user's messages are tombstoned ("This message was
 * deleted"), their uploads and avatar are removed from storage, group ownership passes to
 * another member, and the auth user plus all personal rows (profile, settings, blocks,
 * memberships, push subscriptions, reports they filed) are deleted by cascade.
 */
export async function DELETE(request: Request) {
  try {
    // strict: re-validate the session with the Auth server for this destructive action.
    const { userId, supabase } = await requireUser(request, { strict: true });
    const input = await parseJson(request, deleteAccountSchema);
    if (input.confirmation !== "DELETE") throw new AppError("invalid", 'Type "DELETE" to confirm.');
    await enforceRateLimit("accountDelete", userId);

    const admin = getSupabaseAdminClient();

    const { data: admins } = await admin.from("app_admins").select("user_id");
    if (admins?.some((a) => a.user_id === userId) && admins.length === 1) {
      throw new AppError("conflict", "You're the only administrator. Make someone else an administrator before deleting your account.");
    }

    const { error: prepError } = await admin.rpc("prepare_account_deletion", { p_user_id: userId });
    if (prepError) throw fromDatabaseError(prepError, "Could not delete your account.");

    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) throw new AppError("unknown", "Could not delete your account. Please try again.");

    await processStorageDeletions(admin, 1000).catch(() => 0);
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
