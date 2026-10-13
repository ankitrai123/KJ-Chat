import { type BrowserContext, expect, type Page, request as playwrightRequest, test } from "@playwright/test";
import {
  adminClient,
  createConfirmedUser,
  deleteUsers,
  type E2EUser,
  messages,
  newUser,
  signIn,
  SKIP_REASON,
  stack,
  stackConfigured,
  userClient,
} from "../e2e/support/stack";

/**
 * Real-media smoke tests through LiveKit.
 *
 * Chromium's --use-fake-device-for-media-stream provides a synthetic camera (moving test pattern)
 * and microphone (tone); --use-fake-ui-for-media-stream auto-grants permissions and the screen
 * picker. Every RTCPeerConnection the app creates is recorded, and assertions read its
 * getStats(): media only counts as working when bytes and decoded frames are actually received
 * from the other participant through the LiveKit SFU.
 */
test.describe.configure({ mode: "serial" });
test.skip(!stackConfigured, SKIP_REASON);

const CAPTURE_PEER_CONNECTIONS = `(() => {
  const Original = window.RTCPeerConnection;
  if (!Original || window.__kjPeerConnections) return;
  window.__kjPeerConnections = [];
  class Recorded extends Original {
    constructor(...args) {
      super(...args);
      window.__kjPeerConnections.push(this);
    }
  }
  window.RTCPeerConnection = Recorded;
})();`;

interface Inbound {
  audioBytes: number;
  videoBytes: number;
  videoFrames: number;
  videoStreams: number;
}

async function inbound(page: Page): Promise<Inbound> {
  return page.evaluate(async () => {
    const totals = { audioBytes: 0, videoBytes: 0, videoFrames: 0, videoStreams: 0 };
    const pcs = (window as unknown as { __kjPeerConnections?: RTCPeerConnection[] }).__kjPeerConnections ?? [];
    for (const pc of pcs) {
      if (pc.connectionState === "closed") continue;
      const report = await pc.getStats();
      report.forEach((s: RTCStats & { kind?: string; bytesReceived?: number; framesDecoded?: number }) => {
        if (s.type !== "inbound-rtp") return;
        if (s.kind === "audio") totals.audioBytes += s.bytesReceived ?? 0;
        if (s.kind === "video") {
          totals.videoBytes += s.bytesReceived ?? 0;
          totals.videoFrames += s.framesDecoded ?? 0;
          if ((s.bytesReceived ?? 0) > 0) totals.videoStreams += 1;
        }
      });
    }
    return totals;
  });
}

/** Asserts media of `kind` keeps arriving (bytes grow between two samples). */
async function expectReceiving(page: Page, kind: "audio" | "video", minVideoStreams = 1) {
  await expect.poll(async () => (await inbound(page))[kind === "audio" ? "audioBytes" : "videoBytes"], { timeout: 30_000 }).toBeGreaterThan(0);
  const before = await inbound(page);
  await page.waitForTimeout(2500);
  const after = await inbound(page);
  if (kind === "audio") expect(after.audioBytes).toBeGreaterThan(before.audioBytes);
  else {
    expect(after.videoBytes).toBeGreaterThan(before.videoBytes);
    expect(after.videoFrames).toBeGreaterThan(before.videoFrames);
    expect(after.videoStreams).toBeGreaterThanOrEqual(minVideoStreams);
  }
}

const ana = newUser("CallA");
const ben = newUser("CallB");
const cat = newUser("CallC");
const dan = newUser("CallD");
const contexts: BrowserContext[] = [];
let directId = "";
let groupId = "";

async function pageFor(browser: import("@playwright/test").Browser, user: E2EUser) {
  const context = await browser.newContext({ permissions: ["camera", "microphone"] });
  contexts.push(context);
  await context.addInitScript(CAPTURE_PEER_CONNECTIONS);
  const page = await context.newPage();
  await signIn(page, user);
  return page;
}

function callDialog(page: Page) {
  return page.getByRole("dialog", { name: /^Call with/ });
}

test.beforeAll(async () => {
  const health = await (await playwrightRequest.newContext({ baseURL: stack.baseURL })).get("/api/health");
  const body = await health.json();
  test.skip(!body.livekit, "The target app has no LiveKit configuration (LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET).");

  for (const user of [ana, ben, cat, dan]) {
    await createConfirmedUser(user);
    await adminClient().from("profiles").update({ username: user.username, display_name: user.displayName }).eq("id", user.id!);
  }
  const anaApi = await userClient(ana);
  const direct = await anaApi.rpc("get_or_create_direct_conversation", { p_other_user_id: ben.id });
  directId = direct.data as string;
  const group = await anaApi.rpc("create_group", { p_name: "Media group", p_description: null, p_member_ids: [ben.id, cat.id] });
  groupId = group.data as string;
  expect(directId && groupId).toBeTruthy();
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
  await deleteUsers([ana, ben, cat, dan]);
});

test("1:1 video call carries real audio and video both ways, with mute, camera and screen sharing", async ({ browser }) => {
  const a = await pageFor(browser, ana);
  const b = await pageFor(browser, ben);
  await a.goto(`/chats/${directId}`);
  await b.goto("/chats");

  await a.getByRole("button", { name: "Start video call" }).click();
  await expect(b.getByRole("dialog", { name: ana.displayName })).toBeVisible({ timeout: 20_000 });
  await b.getByRole("button", { name: "Accept with video" }).click();

  for (const page of [a, b]) {
    await expect(callDialog(page)).toBeVisible();
    await expect(callDialog(page).getByText(/^\d+:\d{2}/)).toBeVisible({ timeout: 30_000 });
    await expectReceiving(page, "audio");
    await expectReceiving(page, "video");
  }

  // Microphone mute is reflected on the other side.
  await a.getByRole("button", { name: "Toggle microphone" }).click();
  await expect(
    b.locator('[data-lk-local-participant="false"] .lk-track-muted-indicator-microphone[data-lk-muted="true"]').first(),
  ).toBeVisible({ timeout: 15_000 });
  await a.getByRole("button", { name: "Toggle microphone" }).click();

  // Camera off shows the placeholder remotely; back on resumes frames.
  await a.getByRole("button", { name: "Toggle camera" }).click();
  await expect(
    b.locator('[data-lk-local-participant="false"] .lk-track-muted-indicator-camera[data-lk-muted="true"]').first(),
  ).toBeVisible({ timeout: 15_000 });
  await a.getByRole("button", { name: "Toggle camera" }).click();
  await expectReceiving(b, "video");

  // Screen share arrives as an additional live video stream.
  await a.getByRole("button", { name: "Share screen" }).click();
  await expect(a.getByText("You are sharing your screen")).toBeVisible({ timeout: 15_000 });
  await expect(b.locator('[data-lk-source="screen_share"] video').first()).toBeVisible({ timeout: 20_000 });
  await expectReceiving(b, "video", 2);
  await a.getByRole("button", { name: "Stop sharing" }).click();
  await expect(b.locator('[data-lk-source="screen_share"] video')).toHaveCount(0, { timeout: 15_000 });

  // Hanging up ends the 1:1 call for both and leaves a call log entry.
  await a.getByRole("button", { name: "Hang up" }).click();
  await expect(callDialog(b)).toBeHidden({ timeout: 20_000 });
  await b.goto(`/chats/${directId}`);
  await expect(messages(b).getByRole("button", { name: /Video call/ })).toBeVisible({ timeout: 15_000 });
});

test("group call: three participants exchange media; leaving updates the others", async ({ browser }) => {
  const a = await pageFor(browser, ana);
  const b = await pageFor(browser, ben);
  const c = await pageFor(browser, cat);
  await a.goto(`/chats/${groupId}`);
  await b.goto("/chats");
  await c.goto("/chats");

  await a.getByRole("button", { name: "Start video call" }).click();
  for (const page of [b, c]) {
    await expect(page.getByRole("dialog", { name: "Media group" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Accept with video" }).click();
  }

  for (const page of [a, b, c]) {
    await expect(callDialog(page).getByText(/3 in call/)).toBeVisible({ timeout: 30_000 });
    await expectReceiving(page, "video", 2);
    await expectReceiving(page, "audio");
  }

  await c.getByRole("button", { name: "Hang up" }).click();
  await expect(callDialog(c)).toBeHidden({ timeout: 15_000 });
  await expect(callDialog(a).getByText(/2 in call/)).toBeVisible({ timeout: 20_000 });

  // The call stays up for the remaining two.
  await expectReceiving(a, "video");
  await a.getByRole("button", { name: "Hang up" }).click();
  await b.getByRole("button", { name: "Hang up" }).click();
});

test("people outside the conversation cannot obtain call tokens", async ({ browser }) => {
  const a = await pageFor(browser, ana);
  await a.goto(`/chats/${groupId}`);
  await a.getByRole("button", { name: "Start voice call" }).click();
  await expect(callDialog(a)).toBeVisible();

  const { data: call } = await adminClient().from("call_sessions").select("id").eq("conversation_id", groupId).neq("status", "ended").single();
  expect(call?.id).toBeTruthy();

  const outsider = await pageFor(browser, dan);
  const headers = { "Content-Type": "application/json", Origin: stack.baseURL };
  const join = await outsider.request.post(`/api/calls/${call!.id}/join`, { headers, data: {} });
  expect(join.status()).toBe(404);
  const start = await outsider.request.post("/api/calls", { headers, data: { conversationId: groupId, mediaType: "video" } });
  expect(start.status()).toBe(404);

  const anonymous = await playwrightRequest.newContext({ baseURL: stack.baseURL });
  expect((await anonymous.post(`/api/calls/${call!.id}/join`, { headers, data: {} })).status()).toBe(401);

  await a.getByRole("button", { name: "Hang up" }).click();
});
