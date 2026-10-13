import { z } from "zod";
import { fromDatabaseError } from "@/lib/errors";
import { requireUser } from "@/lib/security/auth";
import { jsonError, jsonOk, parseJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { pushSubscriptionSchema } from "@/lib/validation/chat";

/** Registers this browser's push subscription for the signed-in user. */
export async function POST(request: Request) {
  try {
    const { userId, supabase } = await requireUser(request);
    const input = await parseJson(request, pushSubscriptionSchema);
    await enforceRateLimit("pushSubscribe", userId);
    const { error } = await supabase.rpc("register_push_subscription", {
      p_endpoint: input.endpoint,
      p_p256dh: input.keys.p256dh,
      p_auth: input.keys.auth,
      p_user_agent: request.headers.get("user-agent")?.slice(0, 512) ?? null,
    });
    if (error) throw fromDatabaseError(error, "Could not enable notifications.");
    return jsonOk({ ok: true }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

/** Removes a subscription (RLS: only the owner's rows). */
export async function DELETE(request: Request) {
  try {
    const { supabase } = await requireUser(request);
    const { endpoint } = await parseJson(request, z.object({ endpoint: z.url().max(2048) }));
    const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
    if (error) throw fromDatabaseError(error);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
