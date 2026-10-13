"use server";

import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/routes";
import { getAppOrigin } from "@/lib/server/origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  type ForgotPasswordInput,
  forgotPasswordSchema,
  type LoginInput,
  loginSchema,
  type RegisterInput,
  registerSchema,
  type ResetPasswordInput,
  resetPasswordSchema,
} from "@/lib/validation/auth";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string; field?: string };

function firstIssue(error: { issues: { message: string; path: PropertyKey[] }[] }): ActionResult {
  const issue = error.issues[0];
  return { ok: false, error: issue?.message ?? "Invalid input.", field: issue?.path[0]?.toString() };
}

function friendlyAuthError(message: string | undefined, fallback: string): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("invalid login credentials")) return "Incorrect email or password.";
  if (m.includes("email not confirmed")) return "Please confirm your email address first. Check your inbox for the link.";
  if (m.includes("already registered") || m.includes("already been registered")) return "An account with this email already exists.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Please wait a few minutes and try again.";
  if (m.includes("password") && m.includes("weak")) return "That password is too weak. Try a longer one.";
  if (m.includes("signups not allowed") || m.includes("signup is disabled")) return "Registration is currently closed.";
  // The signup trigger raises these when invite-only registration rejects the code.
  if (m.includes("database error saving new user")) return "This invitation code is invalid, expired or already used.";
  if (m.includes("fetch failed") || m.includes("network")) return "Can't reach the server. Check your connection and try again.";
  return fallback;
}

export async function signInAction(input: LoginInput, next?: string): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createSupabaseServerClient();
  try {
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error) return { ok: false, error: friendlyAuthError(error.message, "Could not sign in. Please try again.") };
  } catch (error) {
    return { ok: false, error: friendlyAuthError((error as Error).message, "Could not sign in. Please try again.") };
  }
  redirect(safeNextPath(next));
}

export async function signUpAction(input: RegisterInput): Promise<ActionResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const { email, password, displayName, inviteCode } = parsed.data;

  const supabase = await createSupabaseServerClient();
  try {
    const { data: mode } = await supabase.rpc("get_registration_mode");
    if (mode === "invite") {
      if (!inviteCode) return { ok: false, error: "An invitation code is required to register.", field: "inviteCode" };
      const { data: valid } = await supabase.rpc("validate_app_invite", { p_code: inviteCode });
      if (!valid) return { ok: false, error: "This invitation code is invalid, expired or already used.", field: "inviteCode" };
    }

    const origin = await getAppOrigin();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
        data: { display_name: displayName, ...(inviteCode ? { invite_code: inviteCode } : {}) },
      },
    });
    if (error) return { ok: false, error: friendlyAuthError(error.message, "Could not create your account.") };

    // Email confirmation disabled (e.g. local development): the user is already signed in.
    if (data.session) redirect("/onboarding");

    return {
      ok: true,
      message: "Check your email for a confirmation link to finish creating your account.",
    };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { ok: false, error: friendlyAuthError((error as Error).message, "Could not create your account.") };
  }
}

export async function requestPasswordResetAction(input: ForgotPasswordInput): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createSupabaseServerClient();
  const origin = await getAppOrigin();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });
  if (error && /rate limit|too many/i.test(error.message)) {
    return { ok: false, error: "Too many requests. Please wait a few minutes and try again." };
  }
  if (error && (error.name === "AuthRetryableFetchError" || error.status === 0 || /fetch failed/i.test(error.message))) {
    return { ok: false, error: "Can't reach the server. Check your connection and try again." };
  }
  // Same response whether or not the account exists, so emails can't be enumerated.
  return { ok: true, message: "If an account exists for that email, a reset link is on its way." };
}

export async function updatePasswordAction(input: ResetPasswordInput): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: friendlyAuthError(error.message, "Could not update your password.") };
  return { ok: true, message: "Your password has been updated." };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}

/** Revokes every session of this user (all devices). */
export async function signOutEverywhereAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login");
}

function isRedirect(error: unknown): boolean {
  return typeof error === "object" && error !== null && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}
