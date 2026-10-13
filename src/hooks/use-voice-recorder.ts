"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "requesting" | "recording" | "paused" | "recorded" | "error";

const MAX_DURATION_MS = 15 * 60 * 1000;
const LEVEL_INTERVAL_MS = 100;

/**
 * Candidate containers in preference order. Chromium/Firefox record Opus in WebM; Safari
 * records AAC in MP4. We use the first one the browser reports as supported rather than
 * assuming, and the server re-checks the uploaded bytes.
 */
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus"];

export function pickRecordingMimeType(isSupported: (type: string) => boolean): string | null {
  for (const candidate of MIME_CANDIDATES) {
    try {
      if (isSupported(candidate)) return candidate;
    } catch {
      // isTypeSupported can throw in some embedded browsers
    }
  }
  return null;
}

export function describeMediaError(error: unknown, device: "microphone" | "camera" = "microphone"): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return `${device === "microphone" ? "Microphone" : "Camera"} access was blocked. Allow it in your browser's site settings and try again.`;
    case "NotFoundError":
    case "OverconstrainedError":
      return `No ${device} was found. Connect one and try again.`;
    case "NotReadableError":
    case "AbortError":
      return `Your ${device} is being used by another app or couldn't be started.`;
    default:
      return `Couldn't access your ${device}.`;
  }
}

export interface Recording {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  waveform: number[];
}

export function useVoiceRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const levelsRef = useRef<number[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const accumulatedRef = useRef(0);
  const discardRef = useRef(false);

  const releaseDevices = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
  }, []);

  useEffect(() => releaseDevices, [releaseDevices]);

  const currentElapsed = () => accumulatedRef.current + (startedAtRef.current ? Date.now() - startedAtRef.current : 0);

  const start = useCallback(async () => {
    setError(null);
    setRecording(null);
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice recording isn't supported in this browser.");
      setState("error");
      return;
    }
    const mimeType = pickRecordingMimeType((t) => MediaRecorder.isTypeSupported(t));
    if (!mimeType) {
      setError("This browser can't record audio in a supported format.");
      setState("error");
      return;
    }

    setState("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      setError(describeMediaError(e));
      setState("error");
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    levelsRef.current = [];
    accumulatedRef.current = 0;
    discardRef.current = false;

    // Live input level for the waveform.
    let analyser: AnalyserNode | null = null;
    try {
      const context = new AudioContext();
      audioContextRef.current = context;
      analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
    } catch {
      analyser = null;
    }
    const buffer = analyser ? new Uint8Array(analyser.fftSize) : null;

    const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 });
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const durationMs = currentElapsed();
      startedAtRef.current = 0;
      releaseDevices();
      if (discardRef.current) {
        setState("idle");
        return;
      }
      const baseType = mimeType.split(";")[0];
      const blob = new Blob(chunksRef.current, { type: baseType });
      if (blob.size === 0) {
        setError("The recording was empty. Please try again.");
        setState("error");
        return;
      }
      setRecording({ blob, mimeType: baseType, durationMs, waveform: compressLevels(levelsRef.current, 64) });
      setState("recorded");
    };
    recorder.onerror = () => {
      setError("Recording stopped unexpectedly.");
      setState("error");
      releaseDevices();
    };
    // The microphone can disappear mid-recording (unplugged, permission revoked).
    stream.getAudioTracks()[0]?.addEventListener("ended", () => {
      if (recorder.state !== "inactive") recorder.stop();
    });

    recorder.start(1000);
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setLevels([]);
    setState("recording");

    timerRef.current = setInterval(() => {
      const elapsed = currentElapsed();
      setElapsedMs(elapsed);
      if (analyser && buffer && recorderRef.current?.state === "recording") {
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (const v of buffer) sum += ((v - 128) / 128) ** 2;
        const level = Math.min(100, Math.round(Math.sqrt(sum / buffer.length) * 300));
        levelsRef.current.push(level);
        setLevels(levelsRef.current.slice(-48));
      }
      if (elapsed >= MAX_DURATION_MS && recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
    }, LEVEL_INTERVAL_MS);
  }, [releaseDevices]);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state !== "recording") return;
    recorder.pause();
    accumulatedRef.current += Date.now() - startedAtRef.current;
    startedAtRef.current = 0;
    setState("paused");
  }, []);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state !== "paused") return;
    recorder.resume();
    startedAtRef.current = Date.now();
    setState("recording");
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const cancel = useCallback(() => {
    discardRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else releaseDevices();
    setRecording(null);
    setError(null);
    setElapsedMs(0);
    setState("idle");
  }, [releaseDevices]);

  return { state, elapsedMs, levels, error, recording, start, pause, resume, stop, cancel };
}

export function compressLevels(levels: number[], buckets: number): number[] {
  if (levels.length <= buckets) return levels.map((l) => Math.round(l));
  const out: number[] = [];
  for (let i = 0; i < buckets; i += 1) {
    const start = Math.floor((i / buckets) * levels.length);
    const end = Math.floor(((i + 1) / buckets) * levels.length);
    const slice = levels.slice(start, Math.max(end, start + 1));
    out.push(Math.round(Math.max(...slice)));
  }
  return out;
}
