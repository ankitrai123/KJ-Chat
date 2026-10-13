/**
 * Turns message text into render tokens. Rendering is done by React (never innerHTML), so the
 * only security concern is which URLs become links: only http(s) and mailto are allowed.
 */
export type MessageToken =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string }
  | { type: "mention"; value: string; username: string };

const TOKEN_PATTERN =
  /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]|www\.[^\s<>"']+[^\s<>"'.,;:!?)\]}]|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(?<![A-Za-z0-9_])@[A-Za-z0-9_]{3,30})/g;

export function safeHref(raw: string): string | null {
  const candidate = raw.startsWith("www.") ? `https://${raw}` : raw;
  try {
    const url = new URL(candidate);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") {
      return url.toString();
    }
  } catch {
    return null;
  }
  return null;
}

export function tokenizeMessage(content: string, mentionable?: (username: string) => boolean): MessageToken[] {
  const tokens: MessageToken[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(TOKEN_PATTERN)) {
    const value = match[0];
    const index = match.index ?? 0;
    let token: MessageToken | null = null;

    if (value.startsWith("@")) {
      const username = value.slice(1).toLowerCase();
      if (!mentionable || mentionable(username)) token = { type: "mention", value, username };
    } else if (value.includes("@") && !value.includes("/")) {
      const href = safeHref(`mailto:${value}`);
      if (href) token = { type: "link", value, href };
    } else {
      const href = safeHref(value);
      if (href) token = { type: "link", value, href };
    }

    if (!token) continue;
    if (index > lastIndex) tokens.push({ type: "text", value: content.slice(lastIndex, index) });
    tokens.push(token);
    lastIndex = index + value.length;
  }

  if (lastIndex < content.length) tokens.push({ type: "text", value: content.slice(lastIndex) });
  return tokens;
}

/** True when the text is only 1–3 emoji (rendered larger, like most chat apps). */
export function isEmojiOnly(content: string | null | undefined): boolean {
  if (!content) return false;
  const trimmed = content.trim();
  if (!trimmed || trimmed.length > 32) return false;
  const segments = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed))
    .map((s) => s.segment)
    .filter((s) => s.trim());
  if (segments.length === 0 || segments.length > 3) return false;
  return segments.every((s) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s));
}

/** Short single-line preview used in the conversation list, notifications and reply bars. */
export function messagePreview(message: {
  message_type: string;
  content: string | null;
  deleted_at?: string | null;
  attachment_kind?: string | null;
  metadata?: Record<string, unknown> | null;
}): string {
  if (message.deleted_at) return "This message was deleted";
  const text = message.content?.replace(/\s+/g, " ").trim();
  const kind = message.message_type === "text" ? null : message.message_type;
  switch (kind ?? message.attachment_kind) {
    case "image":
      return text ? `📷 ${text}` : "📷 Photo";
    case "video":
      return text ? `🎥 ${text}` : "🎥 Video";
    case "audio":
      return text ? `🎵 ${text}` : "🎵 Audio";
    case "voice":
      return "🎤 Voice message";
    case "file":
      return text ? `📄 ${text}` : "📄 Document";
    case "call": {
      const media = message.metadata?.media_type === "video" ? "Video call" : "Voice call";
      const reason = message.metadata?.end_reason;
      if (reason === "missed" || reason === "declined" || reason === "busy") return `Missed ${media.toLowerCase()}`;
      if (reason === "cancelled") return `Cancelled ${media.toLowerCase()}`;
      return media;
    }
    case "system":
      return systemEventText(message.metadata ?? {}, () => "Someone");
    default:
      return text ?? "";
  }
}

export function systemEventText(metadata: Record<string, unknown>, nameOf: (userId: string | null) => string, actorId?: string | null): string {
  const actor = nameOf(actorId ?? null);
  const target = typeof metadata.user_id === "string" ? nameOf(metadata.user_id) : "someone";
  switch (metadata.event) {
    case "group_created":
      return `${actor} created the group "${String(metadata.name ?? "")}"`;
    case "group_renamed":
      return `${actor} renamed the group to "${String(metadata.name ?? "")}"`;
    case "members_added": {
      const ids = Array.isArray(metadata.user_ids) ? (metadata.user_ids as string[]) : [];
      return `${actor} added ${ids.map((id) => nameOf(id)).join(", ") || "members"}`;
    }
    case "member_removed":
      return `${actor} removed ${target}`;
    case "member_left":
      return `${target} left`;
    case "member_joined":
      return `${target} joined using an invite link`;
    case "role_changed":
      return metadata.role === "admin" ? `${actor} made ${target} an admin` : `${actor} removed ${target} as admin`;
    case "owner_changed":
      return `${actor} made ${target} the group owner`;
    default:
      return "Group updated";
  }
}
