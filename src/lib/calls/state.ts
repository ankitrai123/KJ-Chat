/**
 * Client-side call state machine. Pure, so transitions are unit-tested.
 *
 *   idle ──START──▶ starting ──OUTGOING_READY──▶ ringing ──REMOTE_JOINED──▶ connected
 *     │                                              │
 *     └──INCOMING──▶ incoming ──ACCEPT──▶ connecting ──ROOM_CONNECTED──▶ connected
 *                                                     ▲        │
 *                         RECONNECTED ─── reconnecting ◀─ RECONNECTING
 *   any ──ENDED / DECLINE / FAILED──▶ ended ──RESET──▶ idle
 */
export type CallPhase = "idle" | "starting" | "ringing" | "incoming" | "connecting" | "connected" | "reconnecting" | "ended";

export interface CallState {
  phase: CallPhase;
  callId: string | null;
  conversationId: string | null;
  mediaType: "audio" | "video";
  isOutgoing: boolean;
  callerId: string | null;
  token: string | null;
  serverUrl: string | null;
  connectedAt: number | null;
  endReason: string | null;
  error: string | null;
}

export type CallEvent =
  | { type: "START"; conversationId: string; mediaType: "audio" | "video" }
  | { type: "OUTGOING_READY"; callId: string; token: string; serverUrl: string; alreadyActive: boolean }
  | { type: "INCOMING"; callId: string; conversationId: string; mediaType: "audio" | "video"; callerId: string | null }
  | { type: "ACCEPT" }
  | { type: "JOIN"; callId: string; conversationId: string; mediaType: "audio" | "video" }
  | { type: "TOKEN"; token: string; serverUrl: string }
  | { type: "ROOM_CONNECTED"; at: number }
  | { type: "REMOTE_JOINED"; at: number }
  | { type: "RECONNECTING" }
  | { type: "RECONNECTED" }
  | { type: "ENDED"; reason: string }
  | { type: "FAILED"; error: string }
  | { type: "DISMISS_INCOMING"; callId: string }
  | { type: "RESET" };

export const initialCallState: CallState = {
  phase: "idle",
  callId: null,
  conversationId: null,
  mediaType: "audio",
  isOutgoing: false,
  callerId: null,
  token: null,
  serverUrl: null,
  connectedAt: null,
  endReason: null,
  error: null,
};

const ACTIVE: CallPhase[] = ["starting", "ringing", "connecting", "connected", "reconnecting"];

export function isCallActive(state: CallState): boolean {
  return ACTIVE.includes(state.phase);
}

export function callReducer(state: CallState, event: CallEvent): CallState {
  switch (event.type) {
    case "START":
      if (isCallActive(state)) return state;
      return { ...initialCallState, phase: "starting", conversationId: event.conversationId, mediaType: event.mediaType, isOutgoing: true };

    case "OUTGOING_READY":
      if (state.phase !== "starting") return state;
      return {
        ...state,
        phase: event.alreadyActive ? "connecting" : "ringing",
        callId: event.callId,
        token: event.token,
        serverUrl: event.serverUrl,
      };

    case "INCOMING":
      // Never interrupt an active call or replace another ringing invitation.
      if (state.phase !== "idle" && state.phase !== "ended") return state;
      return {
        ...initialCallState,
        phase: "incoming",
        callId: event.callId,
        conversationId: event.conversationId,
        mediaType: event.mediaType,
        callerId: event.callerId,
      };

    case "ACCEPT":
      if (state.phase !== "incoming") return state;
      return { ...state, phase: "connecting" };

    case "JOIN":
      if (isCallActive(state)) return state;
      return { ...initialCallState, phase: "connecting", callId: event.callId, conversationId: event.conversationId, mediaType: event.mediaType };

    case "TOKEN":
      if (state.phase !== "connecting") return state;
      return { ...state, token: event.token, serverUrl: event.serverUrl };

    case "ROOM_CONNECTED":
      // The caller stays "ringing" (alone in the room) until someone answers.
      if (state.phase === "connecting") return { ...state, phase: "connected", connectedAt: state.connectedAt ?? event.at };
      return state;

    case "REMOTE_JOINED":
      if (state.phase === "ringing" || state.phase === "connecting") {
        return { ...state, phase: "connected", connectedAt: state.connectedAt ?? event.at };
      }
      return state;

    case "RECONNECTING":
      if (state.phase !== "connected" && state.phase !== "ringing") return state;
      return { ...state, phase: "reconnecting" };

    case "RECONNECTED":
      if (state.phase !== "reconnecting") return state;
      return { ...state, phase: state.connectedAt ? "connected" : "ringing" };

    case "ENDED":
      if (state.phase === "idle") return state;
      return { ...state, phase: "ended", endReason: event.reason, token: null };

    case "FAILED":
      if (state.phase === "idle") return state;
      return { ...state, phase: "ended", endReason: "failed", error: event.error, token: null };

    case "DISMISS_INCOMING":
      if (state.phase !== "incoming" || state.callId !== event.callId) return state;
      return initialCallState;

    case "RESET":
      return initialCallState;

    default:
      return state;
  }
}

export function endReasonText(reason: string | null, isOutgoing: boolean): string {
  switch (reason) {
    case "declined":
      return isOutgoing ? "Call declined" : "Call ended";
    case "busy":
      return "They're on another call";
    case "missed":
      return isOutgoing ? "No answer" : "Missed call";
    case "cancelled":
      return "Call cancelled";
    case "failed":
      return "Call failed";
    default:
      return "Call ended";
  }
}
