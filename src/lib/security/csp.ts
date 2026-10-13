/**
 * Builds the Content-Security-Policy for HTML responses.
 *
 * Scripts: nonce + strict-dynamic (no inline or third-party scripts without the nonce).
 * Styles: 'unsafe-inline' is required because Radix UI, LiveKit components and sonner set
 * inline styles at runtime; style injection is far less dangerous than script injection.
 */
export interface CspOptions {
  nonce: string;
  supabaseUrl: string;
  livekitUrl?: string;
  isDev: boolean;
}

function origins(url: string | undefined): string[] {
  if (!url) return [];
  try {
    const parsed = new URL(url);
    const host = parsed.host;
    const secure = parsed.protocol === "https:" || parsed.protocol === "wss:";
    return [`${secure ? "https" : "http"}://${host}`, `${secure ? "wss" : "ws"}://${host}`];
  } catch {
    return [];
  }
}

function supabaseOrigins(url: string): string[] {
  const base = origins(url);
  try {
    const parsed = new URL(url);
    // Hosted projects can also serve storage from <ref>.storage.supabase.co.
    if (parsed.hostname.endsWith(".supabase.co")) {
      const ref = parsed.hostname.split(".")[0];
      base.push(`https://${ref}.storage.supabase.co`);
    }
  } catch {
    // ignore malformed URL; config validation reports it elsewhere
  }
  return base;
}

export function buildContentSecurityPolicy({ nonce, supabaseUrl, livekitUrl, isDev }: CspOptions): string {
  const supabase = supabaseOrigins(supabaseUrl);
  const httpSupabase = supabase.filter((o) => o.startsWith("http"));
  // LiveKit Cloud routes clients to regional hosts under *.livekit.cloud.
  const livekit = [...origins(livekitUrl), "https://*.livekit.cloud", "wss://*.livekit.cloud"];

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:", ...httpSupabase],
    "media-src": ["'self'", "blob:", "data:", ...httpSupabase],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...supabase, ...livekit],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  const policy = Object.entries(directives)
    .map(([name, values]) => `${name} ${Array.from(new Set(values)).join(" ")}`)
    .join("; ");

  return isDev ? policy : `${policy}; upgrade-insecure-requests`;
}

export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
