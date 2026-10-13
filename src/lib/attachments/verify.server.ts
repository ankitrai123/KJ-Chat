import "server-only";

import { fileTypeFromBuffer } from "file-type";
import { AppError } from "@/lib/errors";
import { publicEnv } from "@/lib/env";
import type { AdminSupabase } from "@/lib/supabase/admin";
import type { AttachmentInput } from "@/lib/validation/chat";
import {
  BUCKET_HARD_LIMIT_BYTES,
  isSniffCompatible,
  kindForMimeType,
  looksLikeText,
  normalizeMimeType,
  TEXT_MIME_TYPES,
} from "./rules";

const SNIFF_BYTES = 8192;

export interface VerifiedAttachment {
  path: string;
  kind: AttachmentInput["kind"];
  file_name: string;
  mime_type: string;
  file_size: number;
  width?: number;
  height?: number;
  duration_ms?: number;
  waveform?: number[];
}

/**
 * Server-side verification of an uploaded attachment before it may be attached to a message:
 *  - the object lives in the sender's own folder of this conversation,
 *  - it exists in storage, and its stored size is within limits,
 *  - its declared type is allowed, and its first bytes match that type (content sniffing),
 *    so a renamed executable can't masquerade as a PDF or image.
 * Never trusts the browser's size or type claims.
 */
export async function verifyAttachment(
  admin: AdminSupabase,
  input: AttachmentInput,
  context: { conversationId: string; userId: string },
): Promise<VerifiedAttachment> {
  const [conversationId, uploaderId] = input.path.split("/");
  if (conversationId !== context.conversationId || uploaderId !== context.userId) {
    throw new AppError("forbidden", "That attachment doesn't belong to you.");
  }

  const declared = normalizeMimeType(input.mimeType);
  const baseKind = kindForMimeType(declared);
  if (!baseKind) throw new AppError("invalid", `${input.fileName}: this file type isn't allowed.`);
  if (input.kind === "voice" && !declared.startsWith("audio/")) {
    throw new AppError("invalid", "Voice messages must be audio.");
  }
  if (input.kind !== "voice" && input.kind !== baseKind) {
    throw new AppError("invalid", `${input.fileName}: attachment type mismatch.`);
  }

  const { data: info, error: infoError } = await admin.storage.from("attachments").info(input.path);
  if (infoError || !info) throw new AppError("not_found", `${input.fileName} hasn't finished uploading. Please retry.`);

  const size = Number(info.size ?? 0);
  const maxBytes = Math.min(publicEnv.maxAttachmentMb * 1024 * 1024, BUCKET_HARD_LIMIT_BYTES);
  if (!size || size > maxBytes) throw new AppError("invalid", `${input.fileName} is too large.`);

  const sample = await readHead(admin, input.path);
  if (TEXT_MIME_TYPES.has(declared)) {
    if (!looksLikeText(sample)) throw new AppError("invalid", `${input.fileName} doesn't look like a text file.`);
  } else {
    const detected = await fileTypeFromBuffer(sample);
    if (!detected || !isSniffCompatible(declared, detected.mime)) {
      throw new AppError("invalid", `${input.fileName}: the file contents don't match its type.`);
    }
  }

  return {
    path: input.path,
    kind: input.kind,
    file_name: input.fileName,
    mime_type: declared,
    file_size: size,
    width: input.width,
    height: input.height,
    duration_ms: input.durationMs,
    waveform: input.waveform,
  };
}

async function readHead(admin: AdminSupabase, path: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from("attachments").createSignedUrl(path, 60);
  if (error || !data) throw new AppError("not_found", "Attachment not found.");
  const response = await fetch(data.signedUrl, { headers: { Range: `bytes=0-${SNIFF_BYTES - 1}` }, cache: "no-store" });
  if (!response.ok && response.status !== 206) throw new AppError("unavailable", "Could not verify the attachment. Please retry.");

  // Read at most SNIFF_BYTES even if the server ignored the Range header.
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer()).subarray(0, SNIFF_BYTES);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < SNIFF_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => undefined);
  const out = new Uint8Array(Math.min(total, SNIFF_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.subarray(0, out.length - offset);
    out.set(slice, offset);
    offset += slice.length;
    if (offset >= out.length) break;
  }
  return out;
}
