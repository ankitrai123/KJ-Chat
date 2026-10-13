import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your profile" };

export default async function OnboardingPage() {
  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (!profile) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6 text-center">
        <p className="max-w-sm text-muted-foreground">
          Your profile couldn&apos;t be loaded. Please refresh the page; if this keeps happening, contact the administrator.
        </p>
      </main>
    );
  }
  if (profile.username) redirect("/chats");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-chat px-4 py-10">
      <div className="mb-8">
        <BrandMark />
      </div>
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold">Set up your profile</h1>
        <p className="mb-6 text-sm text-muted-foreground">Choose how others will find and see you.</p>
        <OnboardingForm userId={userId} initialDisplayName={profile.display_name} />
      </div>
    </main>
  );
}
