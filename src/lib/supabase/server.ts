import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

export type ServerSupabase = SupabaseClient<Database>;

/**
 * Request-scoped client acting as the signed-in user (RLS applies). Create a new one per
 * request; never share it between requests.
 */
export async function createSupabaseServerClient(): Promise<ServerSupabase> {
  const cookieStore = await cookies();

  return createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The proxy refreshes
          // the session cookies on every request, so this is safe to ignore.
        }
      },
    },
  });
}
