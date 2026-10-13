import { NextResponse } from "next/server";
import { isSupabaseConfigured, isWebPushConfigured } from "@/lib/env";
import { isLiveKitConfigured, isServiceRoleConfigured, serverEnv } from "@/lib/env.server";

/** Deployment smoke check: reports which integrations are configured (booleans only, never values). */
export function GET() {
  return NextResponse.json(
    {
      ok: true,
      supabase: isSupabaseConfigured(),
      serverKey: isServiceRoleConfigured(),
      livekit: isLiveKitConfigured(),
      webPush: isWebPushConfigured() && Boolean(serverEnv.vapidPrivateKey && serverEnv.vapidSubject),
      cron: Boolean(serverEnv.cronSecret),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
