"use client";

import "@livekit/components-styles";
import {
  CarouselLayout,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  isTrackReference,
  LayoutContextProvider,
  LiveKitRoom,
  MediaDeviceSelect,
  ParticipantTile,
  RoomAudioRenderer,
  StartAudio,
  TrackToggle,
  useCreateLayoutContext,
  useLocalParticipant,
  usePinnedTracks,
  useRemoteParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { DisconnectReason, MediaDeviceFailure, RoomEvent, type RoomOptions, Track, VideoPresets } from "livekit-client";
import { Maximize2, Minimize2, MicOff, PhoneOff, PictureInPicture2, Settings2, ShieldAlert, Shrink, UserX, Users } from "lucide-react";
import { type Dispatch, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/profile/user-avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiFetch } from "@/lib/api-client";
import { type CallEvent, type CallState, endReasonText } from "@/lib/calls/state";
import { formatDuration } from "@/lib/chat/time";
import { toUserMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { type ConversationSummary, conversationTitle } from "@/types/chat";

function mediaFailureMessage(failure?: MediaDeviceFailure, kind?: MediaDeviceKind): string {
  const device = kind === "videoinput" ? "camera" : "microphone";
  switch (failure) {
    case MediaDeviceFailure.PermissionDenied:
      return `Access to your ${device} was blocked. Allow it in the browser's site settings to be heard${device === "camera" ? "/seen" : ""}.`;
    case MediaDeviceFailure.NotFound:
      return `No ${device} found. You can still listen and watch.`;
    case MediaDeviceFailure.DeviceInUse:
      return `Your ${device} is in use by another app.`;
    default:
      return `Couldn't start your ${device}.`;
  }
}

function statusText(state: CallState, now: number): string {
  switch (state.phase) {
    case "starting":
      return "Calling…";
    case "ringing":
      return "Ringing…";
    case "connecting":
      return "Connecting…";
    case "reconnecting":
      return "Reconnecting…";
    case "ended":
      return endReasonText(state.endReason, state.isOutgoing);
    case "connected":
      return state.connectedAt ? formatDuration((now - state.connectedAt) / 1000) : "Connected";
    default:
      return "";
  }
}

function useNowTicker(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function CallOverlay({
  state,
  conversation,
  myUserId,
  startWithVideo,
  dispatch,
  onHangUp,
}: {
  state: CallState;
  conversation: ConversationSummary | null;
  myUserId: string;
  startWithVideo: boolean;
  dispatch: Dispatch<CallEvent>;
  onHangUp: () => void;
}) {
  const [minimized, setMinimized] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const now = useNowTicker(state.phase === "connected");
  const title = conversation ? conversationTitle(conversation) : "Call";
  const status = statusText(state, now);

  const roomOptions = useMemo<RoomOptions>(
    () => ({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      disconnectOnPageLeave: true,
    }),
    [],
  );

  const ready = Boolean(state.token && state.serverUrl);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal={!minimized}
      aria-label={`Call with ${title}`}
      data-lk-theme="default"
      className={cn(
        "z-50 bg-neutral-950 text-white",
        minimized ? "fixed right-3 bottom-3 w-72 overflow-hidden rounded-xl shadow-2xl" : "fixed inset-0 flex flex-col pt-safe pb-safe",
      )}
    >
      {ready ? (
        <LiveKitRoom
          serverUrl={state.serverUrl!}
          token={state.token!}
          connect={state.phase !== "ended"}
          audio
          video={startWithVideo}
          options={roomOptions}
          className={cn("flex min-h-0 flex-1 flex-col", minimized && "h-auto")}
          style={{ height: minimized ? "auto" : undefined }}
          onConnected={() => dispatch({ type: "ROOM_CONNECTED", at: Date.now() })}
          onDisconnected={(reason) => {
            if (reason === DisconnectReason.CLIENT_INITIATED) return;
            dispatch({
              type: "ENDED",
              reason: reason === DisconnectReason.PARTICIPANT_REMOVED ? "removed" : "completed",
            });
          }}
          onError={(error) => dispatch({ type: "FAILED", error: toUserMessage(error, "The call connection failed.") })}
          onMediaDeviceFailure={(failure, kind) => toast.error(mediaFailureMessage(failure, kind))}
        >
          <CallStage
            state={state}
            conversation={conversation}
            title={title}
            status={status}
            myUserId={myUserId}
            minimized={minimized}
            onToggleMinimize={() => setMinimized((m) => !m)}
            rootRef={rootRef}
            dispatch={dispatch}
            onHangUp={onHangUp}
          />
          <RoomAudioRenderer />
          <StartAudio label="Tap to enable call audio" className="fixed bottom-28 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-white px-4 py-2 text-sm font-medium text-black" />
        </LiveKitRoom>
      ) : (
        <PreConnect title={title} status={status} conversation={conversation} minimized={minimized} onHangUp={onHangUp} />
      )}
    </div>
  );
}

function PreConnect({
  title,
  status,
  conversation,
  minimized,
  onHangUp,
}: {
  title: string;
  status: string;
  conversation: ConversationSummary | null;
  minimized: boolean;
  onHangUp: () => void;
}) {
  return (
    <div className={cn("flex flex-1 flex-col items-center justify-center gap-4 p-6", minimized && "flex-row p-3")}>
      <UserAvatar name={title} path={conversation?.type === "group" ? conversation.avatar_path : conversation?.peer?.avatar_path} size={minimized ? "sm" : "2xl"} isGroup={conversation?.type === "group"} />
      <div className="text-center">
        <p className="text-lg font-semibold">{title}</p>
        <p className="text-sm text-white/70" aria-live="polite">
          {status}
        </p>
      </div>
      <Button size="icon-lg" variant="destructive" className="rounded-full" onClick={onHangUp} aria-label="Cancel call">
        <PhoneOff />
      </Button>
    </div>
  );
}

function CallStage({
  state,
  conversation,
  title,
  status,
  myUserId,
  minimized,
  onToggleMinimize,
  rootRef,
  dispatch,
  onHangUp,
}: {
  state: CallState;
  conversation: ConversationSummary | null;
  title: string;
  status: string;
  myUserId: string;
  minimized: boolean;
  onToggleMinimize: () => void;
  rootRef: React.RefObject<HTMLDivElement | null>;
  dispatch: Dispatch<CallEvent>;
  onHangUp: () => void;
}) {
  const room = useRoomContext();
  const remotes = useRemoteParticipants();
  const { isScreenShareEnabled, localParticipant } = useLocalParticipant();
  const layoutContext = useCreateLayoutContext();
  const [fullscreen, setFullscreen] = useState(false);
  const [showPeople, setShowPeople] = useState(false);

  // Room lifecycle -> state machine.
  useEffect(() => {
    const onJoined = () => dispatch({ type: "REMOTE_JOINED", at: Date.now() });
    const onReconnecting = () => dispatch({ type: "RECONNECTING" });
    const onReconnected = () => dispatch({ type: "RECONNECTED" });
    room.on(RoomEvent.ParticipantConnected, onJoined);
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    if (room.remoteParticipants.size > 0) onJoined();
    return () => {
      room.off(RoomEvent.ParticipantConnected, onJoined);
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
    };
  }, [dispatch, room]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged], onlySubscribed: false },
  );
  const screenShares = tracks.filter((t) => isTrackReference(t) && t.publication.source === Track.Source.ScreenShare);
  const pinned = usePinnedTracks(layoutContext);
  const focusTrack = pinned[0] ?? screenShares[0];
  const others = focusTrack ? tracks.filter((t) => t !== focusTrack) : tracks;

  const canScreenShare = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices && "getDisplayMedia" in navigator.mediaDevices);
  const canPip = typeof document !== "undefined" && "pictureInPictureEnabled" in document && document.pictureInPictureEnabled;
  const canFullscreen = typeof document !== "undefined" && Boolean(document.fullscreenEnabled);
  const isGroup = conversation?.type === "group";
  const canModerate = isGroup && (conversation?.my_role === "owner" || conversation?.my_role === "admin");

  const togglePip = async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
      }
      const video =
        rootRef.current?.querySelector<HTMLVideoElement>('[data-lk-local-participant="false"] video') ??
        rootRef.current?.querySelector<HTMLVideoElement>("video");
      if (!video) {
        toast.info("Picture-in-picture needs someone's video to be on.");
        return;
      }
      await video.requestPictureInPicture();
    } catch {
      toast.error("Picture-in-picture isn't available here.");
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch {
      toast.error("Full screen isn't available here.");
    }
  };

  const moderate = async (identity: string, action: "mute" | "remove") => {
    try {
      await apiFetch(`/api/calls/${state.callId}/moderate`, { method: "POST", body: { action, identity } });
      toast.success(action === "mute" ? "Participant muted" : "Participant removed from the call");
    } catch (error) {
      toast.error(toUserMessage(error));
    }
  };

  const onDeviceError = (source: "microphone" | "camera" | "screen") => (error: Error) => {
    if (source === "screen") {
      toast.error(error.name === "NotAllowedError" ? "Screen sharing was cancelled or blocked." : "Screen sharing isn't available.");
      return;
    }
    toast.error(mediaFailureMessage(MediaDeviceFailure.getFailure(error), source === "camera" ? "videoinput" : "audioinput"));
  };

  if (minimized) {
    return (
      <div className="flex items-center gap-3 p-3">
        <UserAvatar name={title} path={conversation?.type === "group" ? conversation.avatar_path : conversation?.peer?.avatar_path} size="sm" isGroup={isGroup} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="text-xs text-white/70" aria-live="polite">
            {status}
          </p>
        </div>
        <Button size="icon-sm" variant="ghost" className="text-white hover:bg-white/10" onClick={onToggleMinimize} aria-label="Expand call">
          <Maximize2 />
        </Button>
        <Button size="icon-sm" variant="destructive" className="rounded-full" onClick={onHangUp} aria-label="Hang up">
          <PhoneOff />
        </Button>
      </div>
    );
  }

  return (
    <LayoutContextProvider value={layoutContext}>
      <header className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{title}</h2>
          <p className="text-sm text-white/70" aria-live="polite">
            {status}
            {remotes.length > 0 && isGroup ? ` · ${remotes.length + 1} in call` : ""}
          </p>
        </div>
        {canFullscreen && (
          <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "Exit full screen" : "Full screen"}>
            {fullscreen ? <Shrink /> : <Maximize2 />}
          </Button>
        )}
        <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" onClick={onToggleMinimize} aria-label="Minimise call">
          <Minimize2 />
        </Button>
      </header>

      {isScreenShareEnabled && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg bg-primary/90 px-3 py-2 text-sm text-primary-foreground" role="status">
          <ShieldAlert className="size-4" aria-hidden />
          <span className="flex-1">You are sharing your screen</span>
          <Button size="sm" variant="secondary" onClick={() => void localParticipant.setScreenShareEnabled(false)}>
            Stop sharing
          </Button>
        </div>
      )}

      <div className="relative min-h-0 flex-1 px-2">
        {state.phase === "ringing" && remotes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <UserAvatar name={title} path={isGroup ? conversation?.avatar_path : conversation?.peer?.avatar_path} size="2xl" isGroup={isGroup} />
            <p className="text-white/70">{status}</p>
          </div>
        ) : focusTrack ? (
          <FocusLayoutContainer className="h-full">
            <CarouselLayout tracks={others}>
              <ParticipantTile />
            </CarouselLayout>
            <FocusLayout trackRef={focusTrack} />
          </FocusLayoutContainer>
        ) : (
          <GridLayout tracks={tracks} className="h-full">
            <ParticipantTile />
          </GridLayout>
        )}
      </div>

      {showPeople && (
        <aside className="absolute top-16 right-3 z-10 w-72 rounded-xl bg-neutral-900/95 p-3 shadow-xl" aria-label="Participants">
          <h3 className="mb-2 text-sm font-semibold">In this call ({remotes.length + 1})</h3>
          <ul className="grid gap-2">
            <li className="text-sm text-white/80">You</li>
            {remotes.map((p) => (
              <li key={p.identity} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">{p.name || "Participant"}</span>
                {!p.isMicrophoneEnabled && <MicOff className="size-4 text-white/60" aria-label="Muted" />}
                {canModerate && p.identity !== myUserId && (
                  <>
                    <Button size="icon-sm" variant="ghost" className="text-white hover:bg-white/10" onClick={() => void moderate(p.identity, "mute")} aria-label={`Mute ${p.name}`}>
                      <MicOff />
                    </Button>
                    <Button size="icon-sm" variant="ghost" className="text-white hover:bg-white/10" onClick={() => void moderate(p.identity, "remove")} aria-label={`Remove ${p.name} from call`}>
                      <UserX />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </aside>
      )}

      <footer className="flex flex-wrap items-center justify-center gap-3 px-4 py-4" aria-label="Call controls">
        <TrackToggle source={Track.Source.Microphone} onDeviceError={onDeviceError("microphone")} aria-label="Toggle microphone" className="call-control" />
        <TrackToggle source={Track.Source.Camera} onDeviceError={onDeviceError("camera")} aria-label="Toggle camera" className="call-control" />
        {canScreenShare && (
          <TrackToggle
            source={Track.Source.ScreenShare}
            captureOptions={{ audio: true, selfBrowserSurface: "exclude", surfaceSwitching: "include" }}
            onDeviceError={onDeviceError("screen")}
            aria-label="Share screen"
            className="call-control"
          />
        )}
        <Popover>
          <PopoverTrigger asChild>
            <Button size="icon-lg" variant="secondary" className="rounded-full" aria-label="Audio and video settings">
              <Settings2 />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" className="grid w-80 gap-3" data-lk-theme="default">
            <section>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">Microphone</h3>
              <MediaDeviceSelect kind="audioinput" requestPermissions={false} />
            </section>
            <section>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">Camera</h3>
              <MediaDeviceSelect kind="videoinput" requestPermissions={false} />
            </section>
            <section>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">Speaker</h3>
              <MediaDeviceSelect kind="audiooutput" requestPermissions={false} />
              <p className="mt-1 text-xs text-muted-foreground">Speaker selection isn&apos;t supported by every browser.</p>
            </section>
          </PopoverContent>
        </Popover>
        {canPip && (
          <Button size="icon-lg" variant="secondary" className="rounded-full" onClick={() => void togglePip()} aria-label="Picture in picture">
            <PictureInPicture2 />
          </Button>
        )}
        {isGroup && (
          <Button size="icon-lg" variant="secondary" className="rounded-full" onClick={() => setShowPeople((s) => !s)} aria-label="Participants" aria-pressed={showPeople}>
            <Users />
          </Button>
        )}
        <Button size="icon-lg" variant="destructive" className="rounded-full" onClick={onHangUp} aria-label="Hang up">
          <PhoneOff />
        </Button>
      </footer>
    </LayoutContextProvider>
  );
}
