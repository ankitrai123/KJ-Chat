import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import type { Database } from "@/types/database";

export type AdminSupabase = SupabaseClient<Database>;

let admin: AdminSupabase | undefined;

export class MissingServerConfigError extends Error {
  constructor(what: string) {
    super(`${what} is not configured on the server.`);
    this.name = "MissingServerConfigError";
  }
}

/**
 * Privileged client using the Supabase secret key. Bypasses RLS: only use it after the
 * caller's identity has been verified, and only for the service-role functions that take the
 * verified user id as an argument.
 */
export function getSupabaseAdminClient(): AdminSupabase {
  if (!serverEnv.supabaseSecretKey) {
    throw new MissingServerConfigError("SUPABASE_SECRET_KEY");
  }
  if (!admin) {
    admin = createClient<Database>(publicEnv.supabaseUrl, serverEnv.supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return admin;
}
