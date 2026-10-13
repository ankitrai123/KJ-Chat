"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type * as React from "react";
import { toast } from "sonner";
import { useSession } from "@/components/providers/session-provider";
import { useConversations } from "@/hooks/use-conversations";
import { apiFetch } from "@/lib/api-client";
import { callReducer, endReasonText, initialCallState, isCallActive, type CallState } from "@/lib/calls/state";
import { startTone } from "@/lib/calls/ringtone";
import { AppError, toUserMessage } from "@/lib/errors";
import { realtimeBus } from "@/lib/realtime/bus";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { conversationTitle } from "@/types/chat";
import { CallOverlay } from "./call-overlay";
import { IncomingCallDialog } from "./incoming-call-dialog";

interface CallsApi {
  state: CallState;
  activeCallId: string | null;
  busy: boolean;
  startCall: (conversationId: string, mediaType: "audio" | "video") => Promise<void>;
  joinCall: (callId: string, conversationId: string, mediaType?: "audio" | "video") => Promise<void>;
  accept: (withVideo: boolean) => Promise<void>;
  decline: () => Promise<void>;
  hangUp: () => Promise<void>;
  showIncomingIfRinging: (callId: string) => void;
}

const CallsContext = createContext<CallsApi | null>(null);

export function useCalls(): CallsApi {
  const value = useContext(CallsContext);
  if (!value) throw new Error("useCalls must be used inside CallProvider");
  return value;
}

interface JoinResponse {
  call: { id: string; conversation_id: string; media_type: "audio" | "video"; status: string; end_reason: string | null };
  token: string | null;
  serverUrl: string | null;
  busy?: boolean;
  joinedExisting?: boolean;
}

/**
 * Owns the single active call for this browser tab. Media flows through LiveKit; the
 * database tracks the call lifecycle and drives ringing on the other members' devices.
 */
export function CallProvider({ children }: { children: React.ReactNode }) {
  const { userId, settings } = useSession();
  const [state, dispatch] = useReducer(callReducer, initialCallState);
  const stateRef = useRef(state);
  const { data: conversations } = useConversations();
  const conversationsRef = useRef(conversations);
  const [preferVideo, setPreferVideo] = useState(false);

  useEffect(() => {
    stateRef.current = state;
    conversationsRef.current = conversations;
  });

  const considerInvitation = useCallback(
    async (callId: string) => {
      if (isCallActive(stateRef.current) || stateRef.current.phase === "incoming") return;
      const supabase = getSupabaseBrowserClient();
      const { data: call } = await supabase.from("call_sessions").select("*").eq("id", callId).maybeSingle();
      if (!call || call.status !== "ringing" || call.started_by === userId) return;
      if (Date.parse(call.ring_expires_at) <= Date.now()) return;
      dispatch({ type: "INCOMING", callId: call.id, conversationId: call.conversation_id, mediaType: call.media_type, callerId: call.started_by });
    },
    [userId],
  );

  // Invitations and lifecycle updates arrive through the app-wide realtime subscription.
  useEffect(() => {
    const offParticipant = realtimeBus.on("call:participant", (row) => {
      if (row.user_id !== userId) return;
      if (row.status === "invited") void considerInvitation(row.call_id);
      else if (stateRef.current.phase === "incoming" && stateRef.current.callId === row.call_id) {
        // Answered or declined on another of my devices.
        dispatch({ type: "DISMISS_INCOMING", callId: row.call_id });
      }
    });
    const offSession = realtimeBus.on("call:session", (row) => {
      const current = stateRef.current;
      if (row.id !== current.callId) return;
      if (row.status === "ended") {
        if (current.phase === "incoming") dispatch({ type: "DISMISS_INCOMING", callId: row.id });
        else dispatch({ type: "ENDED", reason: row.end_reason ?? "completed" });
      }
    });
    return () => {
      offParticipant();
      offSession();
    };
  }, [considerInvitation, userId]);

  // Pick up invitations that rang while the app was loading.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    void supabase
      .from("call_participants")
      .select("call_id")
      .eq("user_id", userId)
      .eq("status", "invited")
      .order("invited_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.[0]) void considerInvitation(data[0].call_id);
      });
  }, [considerInvitation, userId]);

  // Ring tones, notifications and ring timeouts.
  useEffect(() => {
    if (state.phase === "incoming") {
      const stop = settings.notification_sound ? startTone("incoming") : () => undefined;
      let notification: Notification | null = null;
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible" && settings.notify_calls) {
        const conversation = conversationsRef.current?.find((c) => c.id === state.conversationId);
        notification = new Notification(`Incoming ${state.mediaType === "video" ? "video" : "voice"} call`, {
          body: conversation ? conversationTitle(conversation) : "KJ Chat",
          tag: `call:${state.callId}`,
          requireInteraction: true,
        });
        notification.onclick = () => window.focus();
      }
      const callId = state.callId!;
      const timeout = setTimeout(() => dispatch({ type: "DISMISS_INCOMING", callId }), 50_000);
      return () => {
        stop();
        notification?.close();
        clearTimeout(timeout);
      };
    }
    if (state.phase === "ringing") {
      const stop = settings.notification_sound ? startTone("outgoing") : () => undefined;
      // Nobody answered: leaving marks it missed for everyone.
      const callId = state.callId!;
      const timeout = setTimeout(() => {
        void apiFetch(`/api/calls/${callId}/leave`, { method: "POST", body: {} }).catch(() => undefined);
        dispatch({ type: "ENDED", reason: "missed" });
      }, 46_000);
      return () => {
        stop();
        clearTimeout(timeout);
      };
    }
    if (state.phase === "ended") {
      if (state.error) toast.error(state.error);
      else if (state.endReason && state.endReason !== "completed") toast.info(endReasonText(state.endReason, state.isOutgoing));
      const timer = setTimeout(() => dispatch({ type: "RESET" }), 1200);
      return () => clearTimeout(timer);
    }
  }, [settings.notification_sound, settings.notify_calls, state.callId, state.conversationId, state.endReason, state.error, state.isOutgoing, state.mediaType, state.phase]);

  // Tell the server we left if the tab is closed mid-call (the LiveKit webhook is the backstop).
  useEffect(() => {
    const onPageHide = () => {
      const current = stateRef.current;
      if (!current.callId || !isCallActive(current)) return;
      void fetch(`/api/calls/${current.callId}/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        keepalive: true,
      }).catch(() => undefined);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  const startCall = useCallback(async (conversationId: string, mediaType: "audio" | "video") => {
    if (isCallActive(stateRef.current)) {
      toast.info("You're already in a call.");
      return;
    }
    setPreferVideo(mediaType === "video");
    dispatch({ type: "START", conversationId, mediaType });
    try {
      const res = await apiFetch<JoinResponse>("/api/calls", { method: "POST", body: { conversationId, mediaType } });
      if (res.busy || !res.token || !res.serverUrl) {
        dispatch({ type: "ENDED", reason: res.call.end_reason ?? "busy" });
        return;
      }
      dispatch({ type: "OUTGOING_READY", callId: res.call.id, token: res.token, serverUrl: res.serverUrl, alreadyActive: Boolean(res.joinedExisting && res.call.status === "active") });
    } catch (error) {
      dispatch({ type: "FAILED", error: toUserMessage(error) });
    }
  }, []);

  const joinCall = useCallback(async (callId: string, conversationId: string, mediaType?: "audio" | "video") => {
    if (isCallActive(stateRef.current)) {
      toast.info("You're already in a call.");
      return;
    }
    const media = mediaType ?? conversationsRef.current?.find((c) => c.id === conversationId)?.active_call?.media_type ?? "audio";
    setPreferVideo(media === "video");
    dispatch({ type: "JOIN", callId, conversationId, mediaType: media });
    try {
      const res = await apiFetch<JoinResponse>(`/api/calls/${callId}/join`, { method: "POST", body: {} });
      if (!res.token || !res.serverUrl) throw new AppError("unknown", "Could not join the call.");
      dispatch({ type: "TOKEN", token: res.token, serverUrl: res.serverUrl });
    } catch (error) {
      dispatch({ type: "FAILED", error: toUserMessage(error) });
    }
  }, []);

  const accept = useCallback(async (withVideo: boolean) => {
    const current = stateRef.current;
    if (current.phase !== "incoming" || !current.callId) return;
    setPreferVideo(withVideo);
    dispatch({ type: "ACCEPT" });
    try {
      const res = await apiFetch<JoinResponse>(`/api/calls/${current.callId}/join`, { method: "POST", body: {} });
      if (!res.token || !res.serverUrl) throw new AppError("unknown", "Could not join the call.");
      dispatch({ type: "TOKEN", token: res.token, serverUrl: res.serverUrl });
    } catch (error) {
      dispatch({ type: "FAILED", error: toUserMessage(error) });
    }
  }, []);

  const decline = useCallback(async () => {
    const current = stateRef.current;
    if (current.phase !== "incoming" || !current.callId) return;
    dispatch({ type: "DISMISS_INCOMING", callId: current.callId });
    await apiFetch(`/api/calls/${current.callId}/decline`, { method: "POST", body: {} }).catch(() => undefined);
  }, []);

  const hangUp = useCallback(async () => {
    const current = stateRef.current;
    if (!current.callId) {
      dispatch({ type: "RESET" });
      return;
    }
    dispatch({ type: "ENDED", reason: "completed" });
    await apiFetch(`/api/calls/${current.callId}/leave`, { method: "POST", body: {} }).catch(() => undefined);
  }, []);

  const showIncomingIfRinging = useCallback((callId: string) => void considerInvitation(callId), [considerInvitation]);

  const api = useMemo<CallsApi>(
    () => ({
      state,
      activeCallId: isCallActive(state) ? state.callId : null,
      busy: isCallActive(state),
      startCall,
      joinCall,
      accept,
      decline,
      hangUp,
      showIncomingIfRinging,
    }),
    [accept, decline, hangUp, joinCall, showIncomingIfRinging, startCall, state],
  );

  const conversation = conversations?.find((c) => c.id === state.conversationId) ?? null;

  return (
    <CallsContext value={api}>
      {children}
      {state.phase === "incoming" && <IncomingCallDialog state={state} conversation={conversation} onAccept={accept} onDecline={decline} />}
      {state.phase !== "idle" && state.phase !== "incoming" && (
        <CallOverlay
          state={state}
          conversation={conversation}
          myUserId={userId}
          startWithVideo={preferVideo}
          dispatch={dispatch}
          onHangUp={hangUp}
        />
      )}
    </CallsContext>
  );
}
