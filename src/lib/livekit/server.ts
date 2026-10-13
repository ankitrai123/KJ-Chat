import "server-only";

import { AccessToken, RoomServiceClient, TrackSource, TrackType, WebhookReceiver } from "livekit-server-sdk";
import { AppError } from "@/lib/errors";
import { isLiveKitConfigured, liveKitHttpUrl, serverEnv } from "@/lib/env.server";

/** Token lifetime only bounds the initial join; LiveKit refreshes tokens for connected clients. */
const TOKEN_TTL = "10m";

export function assertLiveKitConfigured() {
  if (!isLiveKitConfigured()) {
    throw new AppError("unavailable", "Calling isn't configured on this server yet (LiveKit credentials missing).");
  }
}

/**
 * Issues a join token scoped to exactly one room, with the minimum grants a call participant
 * needs. Identity is the verified user id, so participants can't impersonate each other.
 */
export async function createJoinToken(options: {
  roomName: string;
  identity: string;
  name: string;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  assertLiveKitConfigured();
  const token = new AccessToken(serverEnv.livekitApiKey, serverEnv.livekitApiSecret, {
    identity: options.identity,
    name: options.name,
    ttl: TOKEN_TTL,
    metadata: options.metadata ? JSON.stringify(options.metadata) : undefined,
  });
  token.addGrant({
    roomJoin: true,
    room: options.roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canUpdateOwnMetadata: false,
    canPublishSources: [TrackSource.MICROPHONE, TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
    roomAdmin: false,
    roomCreate: false,
    roomList: false,
    roomRecord: false,
  });
  return token.toJwt();
}

let service: RoomServiceClient | null = null;
export function roomService(): RoomServiceClient {
  assertLiveKitConfigured();
  if (!service) service = new RoomServiceClient(liveKitHttpUrl(), serverEnv.livekitApiKey, serverEnv.livekitApiSecret);
  return service;
}

let receiver: WebhookReceiver | null = null;
export function webhookReceiver(): WebhookReceiver {
  assertLiveKitConfigured();
  if (!receiver) receiver = new WebhookReceiver(serverEnv.livekitApiKey, serverEnv.livekitApiSecret);
  return receiver;
}

/** Server-side mute of all of a participant's microphone tracks (host moderation). */
export async function muteParticipantAudio(roomName: string, identity: string, trackSid?: string) {
  const rooms = roomService();
  if (trackSid) {
    await rooms.mutePublishedTrack(roomName, identity, trackSid, true);
    return;
  }
  const participant = await rooms.getParticipant(roomName, identity);
  await Promise.all(
    participant.tracks.filter((t) => t.type === TrackType.AUDIO && !t.muted).map((t) => rooms.mutePublishedTrack(roomName, identity, t.sid, true)),
  );
}

/** Best-effort: kick someone out of a room (e.g. removed from the group). */
export async function removeFromRoom(roomName: string, identity: string) {
  try {
    await roomService().removeParticipant(roomName, identity);
  } catch {
    // Not in the room (or the room is gone): nothing to do.
  }
}

/** Best-effort: close a room so every client disconnects (call ended / group deleted). */
export async function closeRoom(roomName: string) {
  try {
    await roomService().deleteRoom(roomName);
  } catch {
    // Room already closed.
  }
}

export function liveKitClientUrl(): string {
  return serverEnv.livekitUrl;
}
