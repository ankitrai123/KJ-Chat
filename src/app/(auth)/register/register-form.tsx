"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FormField, FormMessage } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { type RegisterInput, registerSchema } from "@/lib/validation/auth";
import { signUpAction } from "../actions";

export function RegisterForm({
  inviteRequired,
  initialInvite,
  serverUnavailable,
}: {
  inviteRequired: boolean;
  initialInvite: string;
  serverUnavailable: boolean;
}) {
  const [error, setError] = useState<string | null>(
    serverUnavailable ? "Can't reach the server right now. You can still try to register." : null,
  );
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: "", email: "", password: "", confirmPassword: "", inviteCode: initialInvite },
  });

  const onSubmit = form.handleSubmit((values) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await signUpAction(values);
        if (!result) return;
        if (result.ok) setDone(result.message ?? "Account created.");
        else {
          setError(result.error);
          if (result.field && result.field in values) {
            form.setError(result.field as keyof RegisterInput, { message: result.error });
          }
        }
      } catch (e) {
        if (e instanceof TypeError) setError("Can't reach the server. Check your connection and try again.");
        else throw e;
      }
    });
  });

  if (done) {
    return (
      <div className="grid justify-items-center gap-3 text-center" role="status">
        <MailCheck className="size-10 text-primary" aria-hidden />
        <p className="text-sm">{done}</p>
      </div>
    );
  }

  const errors = form.formState.errors;
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage>{error}</FormMessage>
      <FormField id="displayName" label="Display name" error={errors.displayName?.message}>
        {(p) => <Input {...p} autoComplete="name" autoFocus {...form.register("displayName")} />}
      </FormField>
      <FormField id="email" label="Email" error={errors.email?.message}>
        {(p) => <Input {...p} type="email" autoComplete="email" inputMode="email" {...form.register("email")} />}
      </FormField>
      <FormField id="password" label="Password" error={errors.password?.message} description="At least 8 characters.">
        {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register("password")} />}
      </FormField>
      <FormField id="confirmPassword" label="Confirm password" error={errors.confirmPassword?.message}>
        {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register("confirmPassword")} />}
      </FormField>
      {inviteRequired && (
        <FormField id="inviteCode" label="Invitation code" error={errors.inviteCode?.message}>
          {(p) => <Input {...p} autoComplete="off" spellCheck={false} {...form.register("inviteCode")} />}
        </FormField>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending && <Spinner label="Creating account" />}
        Create account
      </Button>
    </form>
  );
}
