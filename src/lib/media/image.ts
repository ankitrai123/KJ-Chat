"use client";

/** Downscales an image client-side (e.g. avatars) to keep uploads small. */
export async function resizeImage(file: Blob, maxSize = 512, type = "image/webp", quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    if (!blob) throw new Error("Could not encode image");
    // Safari may ignore webp and return PNG; that's still an allowed avatar type.
    return blob;
  } finally {
    bitmap.close();
  }
}

/** Center-crops to a square before resizing, for avatars. */
export async function squareAvatar(file: Blob, size = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    const target = Math.min(size, side);
    const canvas = document.createElement("canvas");
    canvas.width = target;
    canvas.height = target;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available");
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, target, target);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
    if (!blob) throw new Error("Could not encode image");
    return blob;
  } finally {
    bitmap.close();
  }
}

export async function imageDimensions(file: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const result = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return result;
  } catch {
    return null;
  }
}

/** Duration (ms) and, for video, dimensions, read via a detached media element. */
export function mediaMetadata(file: Blob, kind: "audio" | "video"): Promise<{ durationMs?: number; width?: number; height?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(kind);
    el.preload = "metadata";
    const done = (result: { durationMs?: number; width?: number; height?: number }) => {
      URL.revokeObjectURL(url);
      el.removeAttribute("src");
      resolve(result);
    };
    const timer = setTimeout(() => done({}), 5000);
    el.onloadedmetadata = () => {
      clearTimeout(timer);
      const duration = Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : undefined;
      if (el instanceof HTMLVideoElement) {
        done({ durationMs: duration, width: el.videoWidth || undefined, height: el.videoHeight || undefined });
      } else {
        done({ durationMs: duration });
      }
    };
    el.onerror = () => {
      clearTimeout(timer);
      done({});
    };
    el.src = url;
  });
}
