// @vitest-environment node
import { TokenVerifier, TrackSource } from "livekit-server-sdk";
import { beforeAll, describe, expect, it, vi } from "vitest";

const KEY = "APItestkey";
const SECRET = "test-secret-that-is-long-enough-for-hs256-signing";

describe("LiveKit join tokens", () => {
  let createJoinToken: typeof import("@/lib/livekit/server").createJoinToken;

  beforeAll(async () => {
    vi.stubEnv("LIVEKIT_URL", "wss://example.livekit.cloud");
    vi.stubEnv("LIVEKIT_API_KEY", KEY);
    vi.stubEnv("LIVEKIT_API_SECRET", SECRET);
    vi.resetModules();
    ({ createJoinToken } = await import("@/lib/livekit/server"));
  });

  it("scopes the token to one room and the verified identity with minimal grants", async () => {
    const jwt = await createJoinToken({ roomName: "call_abc", identity: "user-1", name: "Ana", metadata: { avatarPath: null } });
    const claims = await new TokenVerifier(KEY, SECRET).verify(jwt);

    expect(claims.sub).toBe("user-1");
    expect(claims.name).toBe("Ana");
    expect(claims.video).toMatchObject({
      roomJoin: true,
      room: "call_abc",
      canPublish: true,
      canSubscribe: true,
      canUpdateOwnMetadata: false,
      roomAdmin: false,
      roomCreate: false,
      roomList: false,
      roomRecord: false,
    });
    const sources = (claims.video?.canPublishSources ?? []).map(String);
    expect(sources.sort()).toEqual(
      [TrackSource.MICROPHONE, TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO].map((s) =>
        String(typeof s === "number" ? ["unknown", "camera", "microphone", "screen_share", "screen_share_audio"][s] : s),
      ).sort(),
    );
  });

  it("expires quickly", async () => {
    const jwt = await createJoinToken({ roomName: "call_abc", identity: "user-1", name: "Ana" });
    const claims = await new TokenVerifier(KEY, SECRET).verify(jwt);
    const lifetime = (claims.exp ?? 0) - (claims.nbf ?? Math.floor(Date.now() / 1000));
    expect(lifetime).toBeGreaterThan(0);
    expect(lifetime).toBeLessThanOrEqual(10 * 60);
  });

  it("cannot be verified with a different secret (tokens are server-signed)", async () => {
    const jwt = await createJoinToken({ roomName: "call_abc", identity: "user-1", name: "Ana" });
    await expect(new TokenVerifier(KEY, "a-different-secret-value-also-long-enough").verify(jwt)).rejects.toThrow();
  });
});
