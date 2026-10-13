/** Route classification shared by the proxy and server components. */

const PUBLIC_PREFIXES = ["/login", "/register", "/forgot-password", "/auth/", "/offline", "/setup"];
const AUTH_PAGES = ["/login", "/register", "/forgot-password"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`));
}

export function isAuthPage(pathname: string): boolean {
  return AUTH_PAGES.includes(pathname);
}

/**
 * Only allows same-site relative paths as post-login redirect targets, preventing open
 * redirects such as `?next=https://evil.example` or `?next=//evil.example`.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/chats"): string {
  if (!next || typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}
