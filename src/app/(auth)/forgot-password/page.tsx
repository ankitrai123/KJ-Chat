"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FormField, FormMessage } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { type ForgotPasswordInput, forgotPasswordSchema } from "@/lib/validation/auth";
import { requestPasswordResetAction } from "../actions";

export default function ForgotPasswordPage() {
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: "" } });

  const onSubmit = form.handleSubmit((values) => {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await requestPasswordResetAction(values);
        setMessage(result.ok ? { tone: "success", text: result.message ?? "Sent." } : { tone: "error", text: result.error });
      } catch {
        setMessage({ tone: "error", text: "Can't reach the server. Check your connection and try again." });
      }
    });
  });

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">Reset your password</h1>
        <p className="text-sm text-muted-foreground">We&apos;ll email you a link to choose a new password.</p>
      </div>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}
        <FormField id="email" label="Email" error={form.formState.errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" autoFocus {...form.register("email")} />}
        </FormField>
        <Button type="submit" disabled={pending} className="w-full">
          {pending && <Spinner label="Sending" />}
          Send reset link
        </Button>
      </form>
      <Link href="/login" className="text-center text-sm text-primary underline-offset-4 hover:underline">
        Back to sign in
      </Link>
    </div>
  );
}
