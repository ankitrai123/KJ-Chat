/**
 * Error handling shared by client and server.
 *
 * Database functions raise user-facing messages with SQLSTATE codes (see the messaging
 * migration header). Those messages are safe to show. Anything else is replaced with a
 * generic message so internal details never reach the UI.
 */

export type ErrorKind =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "conflict"
  | "rate_limited"
  | "unavailable"
  | "network"
  | "unknown";

export class AppError extends Error {
  readonly kind: ErrorKind;
  readonly status: number;
  readonly hint?: string;

  constructor(kind: ErrorKind, message: string, options: { status?: number; hint?: string } = {}) {
    super(message);
    this.name = "AppError";
    this.kind = kind;
    this.status = options.status ?? statusForKind(kind);
    this.hint = options.hint;
  }
}

export function statusForKind(kind: ErrorKind): number {
  switch (kind) {
    case "unauthenticated":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "invalid":
      return 400;
    case "conflict":
      return 409;
    case "rate_limited":
      return 429;
    case "unavailable":
      return 503;
    default:
      return 500;
  }
}

interface DatabaseErrorLike {
  code?: string;
  message?: string;
  hint?: string | null;
  details?: string | null;
}

const FRIENDLY_CONSTRAINTS: Record<string, string> = {
  profiles_username_key: "That username is already taken.",
  profiles_username_format: "Usernames use 3–30 lowercase letters, numbers or underscores.",
  profiles_display_name_length: "Display name must be 1–64 characters.",
  profiles_bio_length: "Bio must be 500 characters or fewer.",
  profiles_status_length: "Status must be 100 characters or fewer.",
  user_blocks_pkey: "You have already blocked this user.",
};

/** Converts a PostgREST / Postgres error into an AppError with a safe, readable message. */
export function fromDatabaseError(error: DatabaseErrorLike | null | undefined, fallback = "Something went wrong."): AppError {
  if (!error) return new AppError("unknown", fallback);
  const code = error.code ?? "";
  const message = error.message ?? fallback;
  const hint = error.hint ?? undefined;

  for (const [constraint, friendly] of Object.entries(FRIENDLY_CONSTRAINTS)) {
    if (message.includes(constraint)) {
      return new AppError(code === "23505" ? "conflict" : "invalid", friendly, { hint });
    }
  }

  switch (code) {
    case "28000":
    case "PGRST301":
    case "PGRST303":
      return new AppError("unauthenticated", "Your session has expired. Please sign in again.", { hint });
    case "42501":
      // Raised by our functions with a readable message; RLS denials have a technical one.
      return new AppError(
        "forbidden",
        message.startsWith("permission denied") || message.includes("row-level security")
          ? "You don't have permission to do that."
          : message,
        { hint },
      );
    case "P0002":
    case "PGRST116":
      return new AppError("not_found", message.startsWith("JSON object") ? "Not found." : message, { hint });
    case "22023":
    case "P0001":
      if (hint === "rate_limited") return new AppError("rate_limited", message, { hint });
      return new AppError("invalid", message, { hint });
    case "23505":
      return new AppError("conflict", "That already exists.", { hint });
    case "23514":
    case "22001":
    case "22P02":
      return new AppError("invalid", "Some of the information provided is not valid.", { hint });
    default:
      return new AppError("unknown", fallback, { hint });
  }
}

/** Best-effort, user-presentable message for any thrown value. */
export function toUserMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) {
    return "You appear to be offline. Check your connection and try again.";
  }
  if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
    return fromDatabaseError(error as DatabaseErrorLike, fallback).message;
  }
  return fallback;
}

export function isNetworkError(error: unknown): boolean {
  if (error instanceof AppError) return error.kind === "network";
  if (error instanceof TypeError) return /fetch|network|load failed/i.test(error.message);
  return false;
}
