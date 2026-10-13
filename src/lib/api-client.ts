import { AppError, type ErrorKind } from "@/lib/errors";

interface ApiErrorBody {
  error?: { message?: string; kind?: ErrorKind; hint?: string | null };
}

/**
 * JSON fetch for our own route handlers. Session cookies are sent automatically (same origin);
 * errors are normalised to AppError with a user-presentable message.
 */
export async function apiFetch<T>(
  path: string,
  options: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
      signal: options.signal,
      cache: "no-store",
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new AppError("network", "You appear to be offline. Check your connection and try again.");
  }

  const text = await response.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!response.ok) {
    const body = (json ?? {}) as ApiErrorBody;
    const kind = body.error?.kind ?? (response.status === 401 ? "unauthenticated" : response.status >= 500 ? "unknown" : "invalid");
    throw new AppError(kind, body.error?.message ?? `Request failed (${response.status}).`, {
      status: response.status,
      hint: body.error?.hint ?? undefined,
    });
  }

  return json as T;
}
