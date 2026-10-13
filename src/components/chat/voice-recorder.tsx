"use client";

import { Mic, Pause, Play, Send, Square, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { useSession } from "@/components/providers/session-provider";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import { buildAttachmentPath } from "@/lib/attachments/rules";
import { uploadAttachment } from "@/lib/attachments/upload";
import { formatDuration } from "@/lib/chat/time";
import { toUserMessage } from "@/lib/errors";
import type { AttachmentInput } from "@/lib/validation/chat";
import { VoicePlayer } from "./voice-player";

/**
 * Record → (pause/resume) → stop → preview → send. The microphone is only requested when the
 * user starts recording and is released as soon as recording stops or is cancelled.
 */
export function VoiceRecorder({
  conversationId,
  onSend,
  onClose,
}: {
  conversationId: string;
  onSend: (attachment: AttachmentInput) => Promise<unknown>;
  onClose: () => void;
}) {
  const { userId } = useSession();
  const recorder = useVoiceRecorder();
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const { start } = recorder;

  useEffect(() => {
    void start();
  }, [start]);

  const previewUrl = useMemo(() => (recorder.recording ? URL.createObjectURL(recorder.recording.blob) : null), [recorder.recording]);
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const send = async () => {
    const recording = recorder.recording;
    if (!recording) return;
    const ext = recording.mimeType === "audio/mp4" ? "m4a" : recording.mimeType === "audio/ogg" ? "ogg" : "webm";
    const fileName = `voice-message.${ext}`;
    const path = buildAttachmentPath(conversationId, userId, crypto.randomUUID(), fileName);
    setUploadProgress(0);
    try {
      await uploadAttachment(path, recording.blob, recording.mimeType, setUploadProgress).promise;
      await onSend({
        path,
        fileName,
        mimeType: recording.mimeType,
        size: recording.blob.size,
        kind: "voice",
        durationMs: recording.durationMs,
        waveform: recording.waveform,
      });
      recorder.cancel();
      onClose();
    } catch (error) {
      setUploadProgress(null);
      toast.error(`${toUserMessage(error)} Your recording is kept; tap send to retry.`);
    }
  };

  const cancel = () => {
    recorder.cancel();
    onClose();
  };

  if (recorder.state === "error") {
    return (
      <div className="flex items-center gap-2 px-2 py-2" role="alert">
        <Mic className="size-5 shrink-0 text-destructive" aria-hidden />
        <p className="flex-1 text-sm text-destructive">{recorder.error}</p>
        <Button size="sm" variant="outline" onClick={() => void recorder.start()}>
          Try again
        </Button>
        <Button size="sm" variant="ghost" onClick={cancel}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-1 py-1.5" aria-live="polite">
      <Button size="icon" variant="ghost" onClick={cancel} aria-label="Delete recording" disabled={uploadProgress !== null}>
        <Trash2 className="text-destructive" />
      </Button>

      {recorder.state === "recorded" && previewUrl && recorder.recording ? (
        <div className="flex flex-1 justify-center">
          <VoicePlayer src={previewUrl} durationMs={recorder.recording.durationMs} waveform={recorder.recording.waveform} />
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className={recorder.state === "recording" ? "size-2.5 shrink-0 animate-pulse rounded-full bg-destructive" : "size-2.5 shrink-0 rounded-full bg-muted-foreground"} aria-hidden />
          <span className="w-12 shrink-0 font-mono text-sm tabular-nums" aria-label="Recording time">
            {formatDuration(recorder.elapsedMs / 1000)}
          </span>
          <div className="flex h-8 min-w-0 flex-1 items-center justify-end gap-[2px] overflow-hidden" aria-hidden>
            {recorder.levels.map((level, i) => (
              <span key={i} className="w-[3px] shrink-0 rounded-full bg-primary" style={{ height: `${Math.max(8, level)}%` }} />
            ))}
          </div>
          <span className="sr-only">{recorder.state === "paused" ? "Recording paused" : recorder.state === "requesting" ? "Waiting for microphone permission" : "Recording"}</span>
        </div>
      )}

      {recorder.state === "recording" && (
        <Button size="icon" variant="ghost" onClick={recorder.pause} aria-label="Pause recording">
          <Pause />
        </Button>
      )}
      {recorder.state === "paused" && (
        <Button size="icon" variant="ghost" onClick={recorder.resume} aria-label="Resume recording">
          <Play />
        </Button>
      )}
      {(recorder.state === "recording" || recorder.state === "paused") && (
        <Button size="icon" variant="outline" onClick={recorder.stop} aria-label="Stop and preview">
          <Square className="fill-current" />
        </Button>
      )}
      {recorder.state === "requesting" && <Spinner label="Waiting for microphone" />}
      {recorder.state === "recorded" && (
        <Button size="icon" className="rounded-full" onClick={() => void send()} disabled={uploadProgress !== null} aria-label="Send voice message">
          {uploadProgress !== null ? <span className="text-[10px] font-semibold">{Math.round(uploadProgress * 100)}%</span> : <Send />}
        </Button>
      )}
    </div>
  );
}
