"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

export type BrowserSupabase = SupabaseClient<Database>;

let client: BrowserSupabase | undefined;

/** Browser client (publishable key only). Sessions live in cookies shared with the server. */
export function getSupabaseBrowserClient(): BrowserSupabase {
  if (!client) {
    client = createBrowserClient<Database>(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey);
  }
  return client;
}
