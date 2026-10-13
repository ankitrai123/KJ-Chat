"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { FormField, FormMessage } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { type ResetPasswordInput, resetPasswordSchema } from "@/lib/validation/auth";
import { updatePasswordAction } from "../(auth)/actions";

/** Reached from a password-recovery email link, which signs the user in first. */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setMessage(null);
    startTransition(async () => {
      const result = await updatePasswordAction(values).catch(() => ({
        ok: false as const,
        error: "Can't reach the server. Check your connection and try again.",
      }));
      if (result.ok) {
        setMessage({ tone: "success", text: "Password updated. Taking you to your chats…" });
        setTimeout(() => router.replace("/chats"), 1200);
      } else {
        setMessage({ tone: "error", text: result.error });
      }
    });
  });

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-chat px-4 py-10">
      <div className="mb-8">
        <BrandMark />
      </div>
      <div className="grid w-full max-w-sm gap-6 rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold">Choose a new password</h1>
          <p className="text-sm text-muted-foreground">You&apos;ll stay signed in on this device.</p>
        </div>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}
          <FormField id="password" label="New password" error={form.formState.errors.password?.message}>
            {(p) => <Input {...p} type="password" autoComplete="new-password" autoFocus {...form.register("password")} />}
          </FormField>
          <FormField id="confirmPassword" label="Confirm password" error={form.formState.errors.confirmPassword?.message}>
            {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register("confirmPassword")} />}
          </FormField>
          <Button type="submit" disabled={pending} className="w-full">
            {pending && <Spinner label="Saving" />}
            Update password
          </Button>
        </form>
      </div>
    </main>
  );
}
