import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  let mode: "open" | "invite" | "unknown" = "unknown";
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_registration_mode");
    if (!error && (data === "open" || data === "invite")) mode = data;
  } catch {
    mode = "unknown";
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">Create your account</h1>
        <p className="text-sm text-muted-foreground">
          {mode === "invite"
            ? "Registration is invite-only. Enter the invitation code you received."
            : "Join with your email address."}
        </p>
      </div>
      <RegisterForm inviteRequired={mode !== "open"} initialInvite={invite ?? ""} serverUnavailable={mode === "unknown"} />
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-primary underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
