import { redirect } from "next/navigation";
import type * as React from "react";
import { AppProviders } from "@/components/providers/app-providers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Gate for every signed-in page: verifies the session server-side, loads the profile and
 * settings (RLS-scoped to the user), and sends users without a username to onboarding.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;
  if (!userId) redirect("/login");

  const [{ data: profile }, { data: settings }, { data: admin }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("app_admins").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);

  if (!profile || !settings) redirect("/onboarding");
  if (!profile.username) redirect("/onboarding");

  return (
    <AppProviders
      userId={userId}
      email={typeof claims?.email === "string" ? claims.email : null}
      isAdmin={Boolean(admin)}
      profile={profile}
      settings={settings}
    >
      {children}
    </AppProviders>
  );
}
