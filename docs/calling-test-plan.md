# Calling test plan

Audio/video calls, group calls and screen sharing run over LiveKit (WebRTC). This plan separates
what is verified automatically, how, and what must be checked by hand on real devices.

## 1. What each layer proves

| Layer | Command | Needs | Proves | Does **not** prove |
| --- | --- | --- | --- | --- |
| Database authorization | `npm run test:integration` | PostgreSQL | Only members can start/join; non-members, ended or expired calls are rejected; busy/decline/missed/cancel/completed transitions; webhook reconciliation; moderation rights | Anything about media |
| Token unit tests | `npm test` | — | Join tokens are bound to one room and the verified identity, expire within 10 minutes, carry minimal grants, and only verify with the server secret | That LiveKit accepts them |
| Call state machine | `npm test` | — | Client phases (ringing, incoming, connecting, connected, reconnecting, ended), no interruption of an active call, multi-device dismissal | Real network behaviour |
| **Real-media smoke** | `npm run test:media` | Running app + Supabase test project + LiveKit Cloud | Independent browser contexts exchange **actual** RTP media through LiveKit, verified from `RTCPeerConnection.getStats()` (inbound bytes and decoded frames grow over time) | Real cameras/microphones, mobile browsers, NAT traversal across networks |
| Manual device matrix (below) | — | Two or more physical devices on different networks | Real capture devices, TURN fallback, background behaviour, OS permission prompts | — |

A call screen appearing is never treated as success: the media suite fails unless bytes and
frames from the other participant keep increasing.

## 2. Automated real-media smoke tests (`tests/media/calls.spec.ts`)

Chromium flags: `--use-fake-device-for-media-stream` (synthetic camera pattern + tone),
`--use-fake-ui-for-media-stream` (auto-grants permissions and the screen picker),
`--auto-select-desktop-capture-source=Entire screen`.

1. **1:1 video call** — A calls B, B accepts with video.
   - Both sides: inbound audio bytes increase; inbound video bytes **and** decoded frames increase.
   - A mutes the microphone → B's tile shows A's microphone as muted; A unmutes.
   - A turns the camera off → B shows A's camera as muted; on again → frames resume.
   - A shares the screen → "You are sharing your screen" banner on A; B renders a
     `screen_share` video element and receives **two** live inbound video streams; A stops → the
     screen-share tile disappears on B.
   - A hangs up → B's call UI closes (1:1 calls end for both) and both chats show a call log entry.
2. **Group call (3 people)** — A starts, B and C accept. Each participant receives ≥ 2 live video
   streams and audio; the header shows "3 in call". C leaves → A sees "2 in call" and media keeps
   flowing between A and B.
3. **Token authorization** — while a group call rings, a signed-in non-member gets `404` from
   `POST /api/calls/:id/join` and `POST /api/calls`; an anonymous request gets `401`.

Run:

```bash
E2E_BASE_URL=http://localhost:3000 \
E2E_SUPABASE_URL=https://<test-project>.supabase.co \
E2E_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
E2E_SUPABASE_SECRET_KEY=sb_secret_... \
npm run test:media
```

The target app must have `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` set; the suite
skips itself (with a message) when `/api/health` reports LiveKit as unconfigured. LiveKit Cloud's
free tier is sufficient; each run uses a few participant-minutes.

## 3. Manual device matrix (before relying on calls)

Use two real people/devices on **different networks** (e.g. home Wi‑Fi and mobile data) so
traffic must traverse NAT/TURN.

| # | Scenario | Devices | Expected |
| --- | --- | --- | --- |
| M1 | Voice call, accept, talk 1 min, hang up | Desktop Chrome ↔ Android Chrome | Two-way audio, duration ticking, call log "Voice call · 1 min" |
| M2 | Video call, toggle camera/mic both sides | Desktop Safari ↔ iPhone Safari (installed PWA) | Video both ways; mute indicators match |
| M3 | Screen share (window, tab, full screen) | Desktop Chrome/Edge/Firefox | Shared content visible; browser's "Stop sharing" ends it and layout returns to grid |
| M4 | Group video call, 4 people, one leaves/rejoins | Mixed | Grid adapts; active speaker highlighted; rejoin via "Join" banner |
| M5 | Network drop: disable Wi‑Fi for 10 s mid-call | Any | "Reconnecting…" then recovers; or ends cleanly after LiveKit gives up |
| M6 | Permission denied for camera/mic | Any | Clear message; can still hear/see others |
| M7 | Busy: A calls B while B is in a call with C | Any | A sees "They're on another call" |
| M8 | Missed: no answer for 45 s | Any | Caller sees "No answer"; callee's chat shows "Missed voice call" |
| M9 | Incoming call with the tab in the background | Desktop | System notification (if allowed) + ringtone after first interaction |
| M10 | Incoming call with the app closed (push enabled) | Android Chrome, installed iOS PWA | Push notification is best-effort; tapping opens the chat with the ringing call if still active |
| M11 | Host moderation in a group call | Desktop | Owner/admin can mute or remove a participant; removed person disconnects |
| M12 | Device switching (headset plug-in, camera switch) | Desktop | Settings popover lists devices; switching applies without rejoining |

Record browser + OS versions for each run in `PROJECT_STATUS.md`.

## 4. Known platform limits (not bugs)

- Screen sharing is not available on iOS/iPadOS or Android browsers (no `getDisplayMedia`); the
  button is hidden there.
- Speaker (audio output) selection works only where `setSinkId` is supported (Chromium-based
  browsers; not Safari or Firefox on all platforms).
- Browsers can't ring reliably while the app is fully closed. Web push delivers a notification,
  but there is no native call UI (no CallKit/ConnectionService) in a web app.
- Picture-in-picture shows one video stream (browser limitation).
