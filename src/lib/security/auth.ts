import "server-only";

import { AppError } from "@/lib/errors";
import { publicEnv } from "@/lib/env";
import { createSupabaseServerClient, type ServerSupabase } from "@/lib/supabase/server";
import { assertSameOrigin } from "./origin";

export interface AuthContext {
  userId: string;
  supabase: ServerSupabase;
}

/**
 * Verifies the caller's session for a route handler. The user id comes from the verified JWT
 * (signature checked by getClaims), never from the request body.
 *
 * `strict: true` additionally asks the Auth server whether the session is still valid, which
 * catches sessions revoked elsewhere; use it for sensitive operations (account deletion).
 */
export async function requireUser(request: Request, options: { strict?: boolean } = {}): Promise<AuthContext> {
  assertSameOrigin(request, publicEnv.appUrl ? [publicEnv.appUrl] : []);
  const supabase = await createSupabaseServerClient();

  if (options.strict) {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw new AppError("unauthenticated", "Please sign in again.");
    return { userId: data.user.id, supabase };
  }

  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || typeof sub !== "string") {
    throw new AppError("unauthenticated", "Please sign in again.");
  }
  return { userId: sub, supabase };
}
