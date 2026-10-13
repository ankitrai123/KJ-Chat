/**
 * Pure notification rules shared by the server (web push) and the client (in-app/browser
 * notifications), so both apply identical mute / mention / quiet-hours logic.
 */

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map((v) => Number.parseInt(v, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** Local wall-clock minutes for `date` in `timeZone` (falls back to UTC for unknown zones). */
export function localMinutes(date: Date, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  }
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/** Quiet hours may wrap midnight (e.g. 22:00–07:00). Start is inclusive, end exclusive. */
export function isWithinQuietHours(date: Date, start: string, end: string, timeZone: string): boolean {
  const now = localMinutes(date, timeZone);
  const s = minutesOf(start);
  const e = minutesOf(end);
  if (s === e) return false;
  return s < e ? now >= s && now < e : now >= s || now < e;
}

export interface NotificationPrefs {
  notify_messages: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  timezone: string;
}

export interface ConversationPrefs {
  muted_until: string | null;
  notification_level: "all" | "mentions" | "none";
}

export function shouldNotifyMessage(
  settings: NotificationPrefs,
  conversation: ConversationPrefs | null,
  options: { mentioned: boolean; now?: Date },
): boolean {
  const now = options.now ?? new Date();
  if (!settings.notify_messages) return false;
  if (settings.quiet_hours_enabled && isWithinQuietHours(now, settings.quiet_hours_start, settings.quiet_hours_end, settings.timezone)) {
    return false;
  }
  const level = conversation?.notification_level ?? "all";
  if (level === "none") return false;
  const muted = Boolean(conversation?.muted_until && Date.parse(conversation.muted_until) > now.getTime());
  // Mentions break through mute (like most chat apps), but not "none" or quiet hours.
  if (muted) return options.mentioned;
  if (level === "mentions") return options.mentioned;
  return true;
}
