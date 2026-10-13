import { describe, expect, it } from "vitest";
import { callReducer, type CallEvent, type CallState, endReasonText, initialCallState, isCallActive } from "@/lib/calls/state";

function run(events: CallEvent[], from: CallState = initialCallState): CallState {
  return events.reduce(callReducer, from);
}

describe("call state machine", () => {
  it("drives an outgoing call through ringing to connected", () => {
    let state = run([{ type: "START", conversationId: "c", mediaType: "video" }]);
    expect(state).toMatchObject({ phase: "starting", isOutgoing: true, mediaType: "video" });
    state = callReducer(state, { type: "OUTGOING_READY", callId: "k", token: "t", serverUrl: "wss://x", alreadyActive: false });
    expect(state.phase).toBe("ringing");
    // Connecting to the room alone keeps it ringing.
    state = callReducer(state, { type: "ROOM_CONNECTED", at: 1 });
    expect(state.phase).toBe("ringing");
    state = callReducer(state, { type: "REMOTE_JOINED", at: 5 });
    expect(state).toMatchObject({ phase: "connected", connectedAt: 5 });
  });

  it("joins an already active group call directly", () => {
    const state = run([
      { type: "START", conversationId: "c", mediaType: "audio" },
      { type: "OUTGOING_READY", callId: "k", token: "t", serverUrl: "wss://x", alreadyActive: true },
      { type: "ROOM_CONNECTED", at: 9 },
    ]);
    expect(state).toMatchObject({ phase: "connected", connectedAt: 9 });
  });

  it("accepts an incoming call", () => {
    const state = run([
      { type: "INCOMING", callId: "k", conversationId: "c", mediaType: "video", callerId: "u" },
      { type: "ACCEPT" },
      { type: "TOKEN", token: "t", serverUrl: "wss://x" },
      { type: "ROOM_CONNECTED", at: 3 },
    ]);
    expect(state).toMatchObject({ phase: "connected", callerId: "u", token: "t", isOutgoing: false });
  });

  it("never lets an incoming call interrupt an active one", () => {
    const active = run([
      { type: "START", conversationId: "c", mediaType: "audio" },
      { type: "OUTGOING_READY", callId: "k", token: "t", serverUrl: "wss://x", alreadyActive: true },
    ]);
    expect(callReducer(active, { type: "INCOMING", callId: "other", conversationId: "d", mediaType: "audio", callerId: "z" })).toBe(active);
    expect(callReducer(active, { type: "START", conversationId: "d", mediaType: "audio" })).toBe(active);
  });

  it("dismisses only the matching invitation (answered on another device / expired)", () => {
    const ringing = run([{ type: "INCOMING", callId: "k", conversationId: "c", mediaType: "audio", callerId: "u" }]);
    expect(callReducer(ringing, { type: "DISMISS_INCOMING", callId: "other" })).toBe(ringing);
    expect(callReducer(ringing, { type: "DISMISS_INCOMING", callId: "k" }).phase).toBe("idle");
  });

  it("handles reconnection", () => {
    let state = run([
      { type: "JOIN", callId: "k", conversationId: "c", mediaType: "audio" },
      { type: "TOKEN", token: "t", serverUrl: "wss://x" },
      { type: "ROOM_CONNECTED", at: 1 },
      { type: "RECONNECTING" },
    ]);
    expect(state.phase).toBe("reconnecting");
    expect(isCallActive(state)).toBe(true);
    state = callReducer(state, { type: "RECONNECTED" });
    expect(state.phase).toBe("connected");
  });

  it("ends, records failures and resets", () => {
    let state = run([
      { type: "JOIN", callId: "k", conversationId: "c", mediaType: "audio" },
      { type: "FAILED", error: "Microphone blocked" },
    ]);
    expect(state).toMatchObject({ phase: "ended", endReason: "failed", error: "Microphone blocked", token: null });
    expect(isCallActive(state)).toBe(false);
    state = callReducer(state, { type: "RESET" });
    expect(state).toEqual(initialCallState);
    expect(callReducer(initialCallState, { type: "ENDED", reason: "completed" })).toBe(initialCallState);
  });

  it("describes end reasons from the caller's point of view", () => {
    expect(endReasonText("declined", true)).toBe("Call declined");
    expect(endReasonText("missed", true)).toBe("No answer");
    expect(endReasonText("missed", false)).toBe("Missed call");
    expect(endReasonText("busy", true)).toBe("They're on another call");
  });
});
