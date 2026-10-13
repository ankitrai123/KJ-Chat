import { AppError } from "@/lib/errors";

/**
 * CSRF defence for cookie-authenticated route handlers: state-changing requests must come
 * from our own origin. Browsers always send Origin on cross-origin POST/PUT/PATCH/DELETE, and
 * the JSON content type additionally forces a CORS preflight that we never approve.
 * (Server Actions have Next.js' built-in equivalent check.)
 */
export function assertSameOrigin(request: Request, allowedOrigins: string[] = []): void {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;

  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin) {
    // Non-browser clients omit Origin; they cannot carry the user's cookies cross-site anyway,
    // but we still require a JSON content type below.
  } else {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new AppError("forbidden", "Invalid request origin.");
    }
    const allowed = new Set([host, ...allowedOrigins.map(safeHost)].filter(Boolean));
    if (!allowed.has(originHost)) {
      throw new AppError("forbidden", "Cross-site requests are not allowed.");
    }
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (method !== "DELETE" && !contentType.toLowerCase().startsWith("application/json")) {
    throw new AppError("invalid", "Requests must use JSON.", { status: 415 });
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
