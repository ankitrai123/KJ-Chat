"use client";

/**
 * Synthesised ring tones (no audio files). Browsers may keep the AudioContext suspended until
 * the user has interacted with the page; in that case the visual alert and system
 * notification still appear, and the tone starts after the first interaction.
 */
export function startTone(kind: "incoming" | "outgoing"): () => void {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return () => undefined;
  let context: AudioContext | null = null;
  try {
    context = new AudioContext();
  } catch {
    return () => undefined;
  }
  const ctx = context;
  const resume = () => void ctx.resume().catch(() => undefined);
  window.addEventListener("pointerdown", resume, { once: true });
  window.addEventListener("keydown", resume, { once: true });

  const burst = (start: number, duration: number, frequencies: number[], volume: number) => {
    for (const frequency of frequencies) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = frequency;
      osc.type = "sine";
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.02);
      gain.gain.setValueAtTime(volume, start + duration - 0.05);
      gain.gain.linearRampToValueAtTime(0, start + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration);
    }
  };

  const pattern = () => {
    const now = ctx.currentTime + 0.05;
    if (kind === "incoming") {
      burst(now, 0.4, [440, 480], 0.12);
      burst(now + 0.6, 0.4, [440, 480], 0.12);
    } else {
      burst(now, 1.0, [425], 0.05);
    }
  };

  resume();
  pattern();
  const interval = setInterval(pattern, kind === "incoming" ? 2500 : 3500);

  return () => {
    clearInterval(interval);
    window.removeEventListener("pointerdown", resume);
    window.removeEventListener("keydown", resume);
    void ctx.close().catch(() => undefined);
  };
}
