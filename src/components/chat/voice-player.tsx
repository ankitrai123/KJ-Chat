"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { useSignedUrl } from "@/hooks/use-signed-url";
import { formatDuration } from "@/lib/chat/time";
import { cn } from "@/lib/utils";

const SPEEDS = [1, 1.5, 2] as const;
const BARS = 40;

/** Downsamples (or pads) a waveform to a fixed bar count, values 0–100. */
export function normalizeWaveform(waveform: number[] | null | undefined, bars = BARS): number[] {
  if (!waveform?.length) return Array.from({ length: bars }, (_, i) => 25 + ((i * 37) % 40));
  const out: number[] = [];
  for (let i = 0; i < bars; i += 1) {
    const start = Math.floor((i / bars) * waveform.length);
    const end = Math.max(start + 1, Math.floor(((i + 1) / bars) * waveform.length));
    const slice = waveform.slice(start, end);
    out.push(Math.max(8, Math.min(100, Math.max(...slice))));
  }
  return out;
}

export function VoicePlayer({
  path,
  src: directSrc,
  durationMs,
  waveform,
  tone = "in",
}: {
  path?: string;
  src?: string;
  durationMs?: number | null;
  waveform?: number[] | null;
  tone?: "in" | "out";
}) {
  const { url } = useSignedUrl("attachments", directSrc ? null : path);
  const src = directSrc ?? url;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState((durationMs ?? 0) / 1000);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const bars = normalizeWaveform(waveform);
  const progress = duration > 0 ? current / duration : 0;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrent(audio.currentTime);
    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
    };
    const onEnd = () => {
      setPlaying(false);
      setCurrent(0);
    };
    const onPlaying = () => {
      setLoading(false);
      setPlaying(true);
    };
    const onPause = () => setPlaying(false);
    const onWaiting = () => setLoading(true);
    const onError = () => {
      setFailed(true);
      setLoading(false);
      setPlaying(false);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("error", onError);
    };
  }, [src]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    if (audio.paused) {
      // Only one voice message plays at a time.
      document.querySelectorAll<HTMLAudioElement>("audio[data-voice]").forEach((other) => {
        if (other !== audio) other.pause();
      });
      setLoading(true);
      try {
        audio.playbackRate = SPEEDS[speedIndex];
        await audio.play();
      } catch {
        setLoading(false);
      }
    } else {
      audio.pause();
    }
  };

  const seek = (fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    audio.currentTime = Math.max(0, Math.min(duration, fraction * duration));
    setCurrent(audio.currentTime);
  };

  const cycleSpeed = () => {
    const next = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  };

  return (
    <div className="flex w-64 max-w-full items-center gap-2 py-1">
      <audio ref={audioRef} src={src ?? undefined} preload="metadata" data-voice className="hidden" />
      <Button
        size="icon-sm"
        variant={tone === "out" ? "secondary" : "default"}
        className="shrink-0 rounded-full"
        onClick={() => void toggle()}
        disabled={!src || failed}
        aria-label={playing ? "Pause voice message" : "Play voice message"}
      >
        {loading && !playing ? <Spinner label="Loading" /> : playing ? <Pause /> : <Play />}
      </Button>
      <div className="min-w-0 flex-1">
        <div className="relative flex h-8 items-center gap-[2px]" aria-hidden>
          {bars.map((value, i) => (
            <span
              key={i}
              className={cn(
                "w-[3px] shrink-0 rounded-full transition-colors",
                i / bars.length < progress ? (tone === "out" ? "bg-bubble-out-foreground" : "bg-primary") : "bg-current opacity-30",
              )}
              style={{ height: `${Math.max(10, value)}%` }}
            />
          ))}
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(progress * 1000)}
            onChange={(e) => seek(Number(e.target.value) / 1000)}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="Seek"
            aria-valuetext={`${formatDuration(current)} of ${formatDuration(duration)}`}
            disabled={!src || !duration}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] opacity-70">
          <span>{failed ? "Can't play" : formatDuration(playing || current > 0 ? current : duration)}</span>
          <button type="button" onClick={cycleSpeed} className="rounded px-1 font-semibold hover:bg-black/5" aria-label="Playback speed">
            {SPEEDS[speedIndex]}×
          </button>
        </div>
      </div>
    </div>
  );
}
