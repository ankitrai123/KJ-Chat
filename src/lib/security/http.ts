import "server-only";

import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { AppError, fromDatabaseError } from "@/lib/errors";
import { MissingServerConfigError } from "@/lib/supabase/admin";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { "Cache-Control": "no-store", ...init?.headers } });
}

/**
 * Converts any error into a JSON response without leaking internals. Unexpected errors are
 * logged server-side by type only (never message bodies, tokens or user content).
 */
export function jsonError(error: unknown) {
  let appError: AppError;
  if (error instanceof AppError) {
    appError = error;
  } else if (error instanceof MissingServerConfigError) {
    appError = new AppError("unavailable", "This feature is not configured on the server yet.");
  } else if (typeof error === "object" && error !== null && "code" in error) {
    appError = fromDatabaseError(error as { code?: string; message?: string; hint?: string });
  } else {
    console.error("[api] unexpected error:", error instanceof Error ? error.name : typeof error);
    appError = new AppError("unknown", "Something went wrong. Please try again.");
  }

  return NextResponse.json(
    { error: { message: appError.message, kind: appError.kind, hint: appError.hint ?? null } },
    { status: appError.status, headers: { "Cache-Control": "no-store" } },
  );
}

/** Parses a JSON body against a Zod schema, throwing a 400 AppError on failure. */
export async function parseJson<T>(request: Request, schema: ZodType<T>, maxBytes = 64 * 1024): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > maxBytes) throw new AppError("invalid", "Request is too large.", { status: 413 });

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > maxBytes) throw new AppError("invalid", "Request is too large.", { status: 413 });
    body = text ? JSON.parse(text) : {};
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("invalid", "Request body must be valid JSON.");
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new AppError("invalid", first?.message ?? "Invalid request.");
  }
  return result.data;
}
