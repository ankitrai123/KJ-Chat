"use client";

import { AppError } from "@/lib/errors";
import { squareAvatar } from "@/lib/media/image";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Crops/resizes the image in the browser and uploads it to the private avatars bucket under a
 * fresh name. Storage policies restrict the folder to the user (or group admins for groups).
 */
export async function uploadAvatar(file: File, folder: `users/${string}` | `groups/${string}`): Promise<string> {
  if (!ACCEPTED.includes(file.type)) {
    throw new AppError("invalid", "Choose a JPEG, PNG, WebP or GIF image.");
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new AppError("invalid", "That image is too large (15 MB max before resizing).");
  }

  let blob: Blob;
  try {
    blob = await squareAvatar(file, 512);
  } catch {
    throw new AppError("invalid", "That image couldn't be read. Try a different file.");
  }

  const ext = blob.type === "image/png" ? "png" : blob.type === "image/jpeg" ? "jpg" : "webp";
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.storage.from("avatars").upload(path, blob, {
    contentType: blob.type || "image/webp",
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw new AppError("unknown", "Upload failed. Please try again.");
  return path;
}

export async function deleteAvatarObject(path: string | null | undefined) {
  if (!path) return;
  const supabase = getSupabaseBrowserClient();
  await supabase.storage.from("avatars").remove([path]);
}
