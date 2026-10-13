/**
 * Attachment rules shared by the browser (pre-upload validation) and the server
 * (post-upload verification). The server never trusts the browser's checks; it re-validates
 * the stored object's size and content signature before attaching it to a message.
 */

export const ATTACHMENT_KINDS = ["image", "video", "audio", "voice", "file"] as const;
export type AttachmentKindName = (typeof ATTACHMENT_KINDS)[number];

export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const BUCKET_HARD_LIMIT_BYTES = 50 * 1024 * 1024;

/** MIME type -> attachment kind. Must stay in sync with the bucket allow-list in the storage migration. */
export const ALLOWED_MIME_TYPES: Record<string, Exclude<AttachmentKindName, "voice">> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/gif": "image",
  "image/webp": "image",
  "image/avif": "image",
  "image/heic": "image",
  "image/heif": "image",
  "video/mp4": "video",
  "video/webm": "video",
  "video/quicktime": "video",
  "video/ogg": "video",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/x-m4a": "audio",
  "audio/aac": "audio",
  "audio/ogg": "audio",
  "audio/opus": "audio",
  "audio/webm": "audio",
  "audio/wav": "audio",
  "audio/x-wav": "audio",
  "audio/flac": "audio",
  "application/pdf": "file",
  "text/plain": "file",
  "text/csv": "file",
  "application/rtf": "file",
  "application/zip": "file",
  "application/msword": "file",
  "application/vnd.ms-excel": "file",
  "application/vnd.ms-powerpoint": "file",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "file",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "file",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "file",
  "application/vnd.oasis.opendocument.text": "file",
  "application/vnd.oasis.opendocument.spreadsheet": "file",
  "application/vnd.oasis.opendocument.presentation": "file",
};

/** Browsers sometimes leave File.type empty; fall back to the extension for the declared type. */
const EXTENSION_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/opus",
  wav: "audio/wav",
  flac: "audio/flac",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  rtf: "application/rtf",
  zip: "application/zip",
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
};

const ZIP_CONTAINERS = [
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
];

/**
 * Families of MIME types that share a container format. A detected (sniffed) type is accepted
 * for a declared type when both are in the same family, e.g. a voice note declared audio/webm
 * may be detected as video/webm because both use the WebM (Matroska) container.
 */
const FAMILIES: string[][] = [
  ["image/jpeg"],
  ["image/png"],
  ["image/gif"],
  ["image/webp"],
  ["image/avif"],
  ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"],
  ["video/mp4", "video/quicktime", "video/x-m4v", "audio/mp4", "audio/x-m4a", "audio/m4a"],
  ["video/webm", "audio/webm", "video/x-matroska"],
  ["video/ogg", "audio/ogg", "audio/opus", "application/ogg"],
  ["audio/mpeg"],
  ["audio/aac", "audio/x-aac"],
  ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"],
  ["audio/flac", "audio/x-flac"],
  ["application/pdf"],
  ZIP_CONTAINERS,
  ["application/x-cfb", "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint"],
  ["application/rtf", "text/rtf"],
];

/** Types with no reliable binary signature; verified by a text heuristic instead. */
export const TEXT_MIME_TYPES = new Set(["text/plain", "text/csv"]);

export function normalizeMimeType(type: string | null | undefined): string {
  return (type ?? "").split(";")[0].trim().toLowerCase();
}

export function fileExtension(name: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return match ? match[1].toLowerCase() : "";
}

/** Resolves the declared MIME type for a browser File, using the extension only as a fallback. */
export function declaredMimeType(file: { name: string; type: string }): string {
  const normalized = normalizeMimeType(file.type);
  if (normalized && normalized !== "application/octet-stream") return normalized;
  return EXTENSION_MIME[fileExtension(file.name)] ?? normalized;
}

export function kindForMimeType(mime: string): Exclude<AttachmentKindName, "voice"> | null {
  return ALLOWED_MIME_TYPES[normalizeMimeType(mime)] ?? null;
}

export function isSniffCompatible(declared: string, sniffed: string): boolean {
  const a = normalizeMimeType(declared);
  const b = normalizeMimeType(sniffed);
  if (a === b) return true;
  return FAMILIES.some((family) => family.includes(a) && family.includes(b));
}

export interface FileCheckResult {
  ok: boolean;
  error?: string;
  mimeType?: string;
  kind?: Exclude<AttachmentKindName, "voice">;
}

export function validateAttachmentFile(
  file: { name: string; type: string; size: number },
  maxBytes: number,
): FileCheckResult {
  if (file.size <= 0) return { ok: false, error: `${file.name} is empty.` };
  if (file.size > Math.min(maxBytes, BUCKET_HARD_LIMIT_BYTES)) {
    return { ok: false, error: `${file.name} is larger than ${formatBytes(Math.min(maxBytes, BUCKET_HARD_LIMIT_BYTES))}.` };
  }
  const mimeType = declaredMimeType(file);
  const kind = kindForMimeType(mimeType);
  if (!kind) return { ok: false, error: `${file.name}: this file type isn't supported.` };
  return { ok: true, mimeType, kind };
}

/** Restricts stored object names to a safe subset; the original name is kept in the database. */
export function sanitizeFileName(name: string): string {
  const ext = fileExtension(name);
  const base = name
    .replace(/\.[^.]*$/, "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 80);
  const safeBase = base || "file";
  return ext ? `${safeBase}.${ext}` : safeBase;
}

export function buildAttachmentPath(conversationId: string, userId: string, objectId: string, fileName: string): string {
  return `${conversationId}/${userId}/${objectId}/${sanitizeFileName(fileName)}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Text heuristic for formats without magic bytes: valid UTF-8 and no NUL bytes in the sample. */
export function looksLikeText(sample: Uint8Array): boolean {
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(trimIncompleteUtf8(sample));
    return true;
  } catch {
    return false;
  }
}

/** A sample cut at an arbitrary byte may end mid-character; drop the partial tail. */
function trimIncompleteUtf8(bytes: Uint8Array): Uint8Array {
  let end = bytes.length;
  let i = end - 1;
  let continuation = 0;
  while (i >= 0 && continuation < 4 && (bytes[i] & 0xc0) === 0x80) {
    continuation += 1;
    i -= 1;
  }
  if (i >= 0) {
    const lead = bytes[i];
    const expected = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
    if (expected > continuation + 1) end = i;
  }
  return bytes.subarray(0, end);
}
