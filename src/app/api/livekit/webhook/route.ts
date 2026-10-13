import { NextResponse } from "next/server";
import { isLiveKitConfigured } from "@/lib/env.server";
import { webhookReceiver } from "@/lib/livekit/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * LiveKit Cloud webhook (Settings → Webhooks → https://<app>/api/livekit/webhook).
 * The Authorization header is a JWT signed with our API secret over the body's SHA-256;
 * WebhookReceiver rejects anything not signed by LiveKit. Keeps call state correct when a
 * browser closes without telling us (tab killed, network lost).
 */
export async function POST(request: Request) {
  if (!isLiveKitConfigured()) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const body = await request.text();
  let event;
  try {
    event = await webhookReceiver().receive(body, request.headers.get("authorization") ?? undefined);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const admin = getSupabaseAdminClient();
  const roomName = event.room?.name;
  try {
    if (event.event === "participant_left" && roomName && event.participant?.identity) {
      await admin.rpc("livekit_participant_left", { p_room_name: roomName, p_identity: event.participant.identity });
    } else if (event.event === "room_finished" && roomName) {
      await admin.rpc("livekit_room_finished", { p_room_name: roomName });
    }
  } catch {
    // Returning 500 makes LiveKit retry delivery.
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
