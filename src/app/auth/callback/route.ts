import { NextResponse } from "next/server";
import { safeNextPath } from "@/lib/routes";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * PKCE callback for confirmation and password-recovery links that use the default
 * {{ .ConfirmationURL }} email template. The code can only be exchanged in the browser that
 * started the flow; see /auth/confirm for the cross-device token_hash variant.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"));

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }

  const login = new URL("/login", url.origin);
  login.searchParams.set(
    "message",
    "That link has expired or was opened in a different browser. If you just confirmed your email, you can sign in now.",
  );
  return NextResponse.redirect(login);
}
