/**
 * Public (browser-safe) configuration. Every value here is inlined into client bundles, so it
 * must never contain secrets. Next.js only inlines `process.env.NEXT_PUBLIC_*` when accessed
 * literally, which is why each variable is read explicitly.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
// Supabase's current publishable key, falling back to the legacy anon key name.
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const publicEnv = {
  supabaseUrl,
  supabasePublishableKey,
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
  vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
  /** Per-file attachment limit in MB. The storage bucket's hard limit is 50 MB. */
  maxAttachmentMb: Math.min(parsePositiveInt(process.env.NEXT_PUBLIC_MAX_ATTACHMENT_MB, 25), 50),
} as const;

export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabasePublishableKey);
}

export function isWebPushConfigured(): boolean {
  return Boolean(publicEnv.vapidPublicKey);
}
