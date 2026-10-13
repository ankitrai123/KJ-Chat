import "server-only";

import { AppError } from "@/lib/errors";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export interface RateLimitRule {
  /** Maximum requests allowed per window. */
  max: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  sendMessage: { max: 40, windowSeconds: 10 },
  callToken: { max: 20, windowSeconds: 60 },
  callAction: { max: 60, windowSeconds: 60 },
  pushSubscribe: { max: 10, windowSeconds: 60 },
  accountDelete: { max: 3, windowSeconds: 3600 },
  groupAdmin: { max: 30, windowSeconds: 60 },
} satisfies Record<string, RateLimitRule>;

/**
 * Fixed-window rate limit stored in Postgres so it holds across serverless instances.
 * Fails open if the limiter itself errors, so a database hiccup never locks users out.
 */
export async function enforceRateLimit(bucket: keyof typeof RATE_LIMITS, subject: string): Promise<void> {
  const rule = RATE_LIMITS[bucket];
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc("check_rate_limit", {
    p_key: `${bucket}:${subject}`,
    p_max: rule.max,
    p_window_seconds: rule.windowSeconds,
  });
  if (error) {
    console.error("[rate-limit] limiter unavailable:", error.code);
    return;
  }
  if (data === false) {
    throw new AppError("rate_limited", "You're doing that too often. Please wait a moment and try again.");
  }
}
