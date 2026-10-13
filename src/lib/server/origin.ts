import "server-only";

import { headers } from "next/headers";
import { publicEnv } from "@/lib/env";

/**
 * Absolute origin used for auth email links. Prefers the configured NEXT_PUBLIC_APP_URL so a
 * spoofed Host header can never redirect users elsewhere; falls back to request headers in
 * local development only.
 */
export async function getAppOrigin(): Promise<string> {
  if (publicEnv.appUrl) return publicEnv.appUrl.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
