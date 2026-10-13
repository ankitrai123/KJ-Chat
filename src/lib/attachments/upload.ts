"use client";

import { AppError } from "@/lib/errors";
import { publicEnv } from "@/lib/env";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface UploadHandle {
  promise: Promise<void>;
  abort: () => void;
}

/**
 * Uploads a file to the private attachments bucket using the Storage REST endpoint directly so
 * we get real progress events and cancellation (supabase-js upload() exposes neither).
 * Authorization is the user's own access token: storage RLS decides whether the write is allowed.
 */
export function uploadAttachment(
  path: string,
  file: Blob,
  contentType: string,
  onProgress: (fraction: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  let aborted = false;

  const promise = (async () => {
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new AppError("unauthenticated", "Please sign in again.");
    if (aborted) throw new AppError("invalid", "Upload cancelled.");

    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    await new Promise<void>((resolve, reject) => {
      xhr.open("POST", `${publicEnv.supabaseUrl}/storage/v1/object/attachments/${encodedPath}`);
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.setRequestHeader("apikey", publicEnv.supabasePublishableKey);
      xhr.setRequestHeader("x-upsert", "false");
      xhr.setRequestHeader("cache-control", "max-age=3600");
      xhr.setRequestHeader("Content-Type", contentType);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.min(0.99, event.loaded / event.total));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(1);
          resolve();
          return;
        }
        reject(new AppError(xhr.status === 413 ? "invalid" : "unknown", uploadErrorMessage(xhr.status, xhr.responseText)));
      };
      xhr.onerror = () => reject(new AppError("network", "Upload failed: check your connection and retry."));
      xhr.onabort = () => reject(new AppError("invalid", "Upload cancelled."));
      xhr.send(file);
    });
  })();

  return {
    promise,
    abort: () => {
      aborted = true;
      xhr.abort();
    },
  };
}

function uploadErrorMessage(status: number, body: string): string {
  if (status === 413) return "That file is too large.";
  if (status === 415 || /mime type/i.test(body)) return "That file type isn't allowed.";
  if (status === 401 || status === 403) return "You can't upload files to this conversation.";
  return "Upload failed. Please retry.";
}

export async function deleteOwnUpload(path: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  await supabase.storage.from("attachments").remove([path]);
}
