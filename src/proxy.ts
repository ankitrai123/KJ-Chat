import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";
import { isAuthPage, isPublicPath } from "@/lib/routes";
import { buildContentSecurityPolicy, createNonce } from "@/lib/security/csp";

type PendingCookie = { name: string; value: string; options: Record<string, unknown> };

/**
 * Runs before every page request:
 *  1. refreshes the Supabase session cookies (tokens expire hourly),
 *  2. redirects signed-out users away from protected pages (and signed-in users away from
 *     the login/register pages),
 *  3. attaches a per-request CSP nonce.
 * Authorization is still enforced by the server and the database; this is only routing.
 */
export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildContentSecurityPolicy({
    nonce,
    supabaseUrl: publicEnv.supabaseUrl,
    livekitUrl: process.env.LIVEKIT_URL,
    isDev: process.env.NODE_ENV === "development",
  });

  const pathname = request.nextUrl.pathname;
  const pendingCookies: PendingCookie[] = [];
  const pendingHeaders: Record<string, string> = {};
  let userId: string | null = null;

  if (!isSupabaseConfigured()) {
    if (pathname !== "/setup") {
      return finalize(NextResponse.redirect(new URL("/setup", request.url)));
    }
  } else {
    const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const cookie of cookiesToSet) {
            request.cookies.set(cookie.name, cookie.value);
            pendingCookies.push(cookie);
          }
          Object.assign(pendingHeaders, headers ?? {});
        },
      },
    });

    try {
      const { data } = await supabase.auth.getClaims();
      userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
    } catch {
      // Auth server unreachable: treat as signed out; pages show their own errors.
      userId = null;
    }
  }

  if (!userId && !isPublicPath(pathname) && pathname !== "/setup") {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return finalize(NextResponse.redirect(loginUrl));
  }

  if (userId && (isAuthPage(pathname) || pathname === "/")) {
    return finalize(NextResponse.redirect(new URL("/chats", request.url)));
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  return finalize(NextResponse.next({ request: { headers: requestHeaders } }));

  function finalize(response: NextResponse) {
    for (const { name, value, options } of pendingCookies) {
      response.cookies.set(name, value, options);
    }
    for (const [key, value] of Object.entries(pendingHeaders)) {
      response.headers.set(key, value);
    }
    response.headers.set("Content-Security-Policy", csp);
    return response;
  }
}

export const config = {
  matcher: [
    {
      source:
        "/((?!api/|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/|sounds/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt|xml)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
