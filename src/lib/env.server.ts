import "server-only";

/**
 * Server-only configuration. Importing this module from a Client Component fails the build
 * (via `server-only`), which keeps these secrets out of browser bundles.
 */
export const serverEnv = {
  // Supabase's current secret key, falling back to the legacy service_role key name.
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  livekitUrl: process.env.LIVEKIT_URL ?? "",
  livekitApiKey: process.env.LIVEKIT_API_KEY ?? "",
  livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? "",
  vapidSubject: process.env.VAPID_SUBJECT ?? "",
  cronSecret: process.env.CRON_SECRET ?? "",
} as const;

export function isLiveKitConfigured(): boolean {
  return Boolean(serverEnv.livekitUrl && serverEnv.livekitApiKey && serverEnv.livekitApiSecret);
}

export function isServiceRoleConfigured(): boolean {
  return Boolean(serverEnv.supabaseSecretKey);
}

/** LiveKit's server API uses HTTP(S); the client connects to the same host over WebSockets. */
export function liveKitHttpUrl(): string {
  return serverEnv.livekitUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
}
