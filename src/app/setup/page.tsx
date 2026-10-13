import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Setup required" };

/** Shown when the deployment is missing its Supabase configuration. Contains no secrets. */
export default function SetupPage() {
  if (isSupabaseConfigured()) redirect("/login");

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-4 py-10">
      <BrandMark />
      <h1 className="text-2xl font-semibold">Configuration required</h1>
      <p className="text-muted-foreground">
        This deployment can&apos;t reach its backend yet. The administrator needs to set these environment variables
        and redeploy:
      </p>
      <ul className="list-disc space-y-1 pl-6 font-mono text-sm">
        <li>NEXT_PUBLIC_SUPABASE_URL</li>
        <li>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</li>
        <li>SUPABASE_SECRET_KEY (server only)</li>
        <li>LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET (server only, for calls)</li>
      </ul>
      <p className="text-sm text-muted-foreground">See README.md → &quot;Configuration&quot; for step-by-step instructions.</p>
    </main>
  );
}
