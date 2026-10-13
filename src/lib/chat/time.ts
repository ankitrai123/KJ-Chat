import { differenceInCalendarDays, format, isSameDay } from "date-fns";

/**
 * Converts a Postgres/PostgREST timestamp to microseconds since the epoch without losing the
 * sub-millisecond part (JavaScript Dates only keep milliseconds). Needed to compare message
 * times against read markers, which the database sets to exact message timestamps.
 */
export function toMicros(timestamp: string): number {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(timestamp.trim());
  if (!match) {
    const ms = Date.parse(timestamp);
    return Number.isNaN(ms) ? 0 : ms * 1000;
  }
  const [, date, time, fraction = "", zone = "Z"] = match;
  const normalizedZone = zone === "Z" ? "Z" : zone.length === 3 ? `${zone}:00` : zone.includes(":") ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const seconds = Date.parse(`${date}T${time}${normalizedZone}`);
  const micros = Number((fraction + "000000").slice(0, 6));
  return seconds * 1000 + micros;
}

export function compareTimestamps(a: string, b: string): number {
  return toMicros(a) - toMicros(b);
}

export function formatMessageTime(timestamp: string): string {
  return format(new Date(timestamp), "HH:mm");
}

/** Conversation-list style: time today, "Yesterday", weekday within a week, else a date. */
export function formatListTimestamp(timestamp: string | null | undefined, now = new Date()): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const days = differenceInCalendarDays(now, date);
  if (days <= 0) return format(date, "HH:mm");
  if (days === 1) return "Yesterday";
  if (days < 7) return format(date, "EEEE");
  if (date.getFullYear() === now.getFullYear()) return format(date, "d MMM");
  return format(date, "d MMM yyyy");
}

export function formatDaySeparator(timestamp: string, now = new Date()): string {
  const date = new Date(timestamp);
  const days = differenceInCalendarDays(now, date);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return format(date, "EEEE");
  return format(date, date.getFullYear() === now.getFullYear() ? "EEEE, d MMMM" : "d MMMM yyyy");
}

export function isDifferentDay(a: string, b: string): boolean {
  return !isSameDay(new Date(a), new Date(b));
}

export function formatLastSeen(timestamp: string | null | undefined, now = new Date()): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (minutes < 1) return "last seen just now";
  if (minutes < 60) return `last seen ${minutes} min ago`;
  const days = differenceInCalendarDays(now, date);
  if (days === 0) return `last seen today at ${format(date, "HH:mm")}`;
  if (days === 1) return `last seen yesterday at ${format(date, "HH:mm")}`;
  return `last seen ${format(date, "d MMM")} at ${format(date, "HH:mm")}`;
}

/** 0:07, 1:05, 1:02:03 */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Human call length: "45 sec", "12 min", "1 hr 5 min". */
export function formatCallDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s} sec`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}
