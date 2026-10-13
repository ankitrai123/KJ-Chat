"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FormField, FormMessage } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { type LoginInput, loginSchema } from "@/lib/validation/auth";
import { signInAction } from "../actions";

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  const onSubmit = form.handleSubmit((values) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await signInAction(values, next);
        if (result && !result.ok) setError(result.error);
      } catch (e) {
        // Redirects surface as thrown navigation signals and are handled by Next.js.
        if (e instanceof TypeError) setError("Can't reach the server. Check your connection and try again.");
        else throw e;
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      {notice && <FormMessage tone="info">{notice}</FormMessage>}
      <FormMessage>{error}</FormMessage>
      <FormField id="email" label="Email" error={form.formState.errors.email?.message}>
        {(p) => <Input {...p} type="email" autoComplete="email" inputMode="email" autoFocus {...form.register("email")} />}
      </FormField>
      <FormField id="password" label="Password" error={form.formState.errors.password?.message}>
        {(p) => <Input {...p} type="password" autoComplete="current-password" {...form.register("password")} />}
      </FormField>
      <Button type="submit" disabled={pending} className="w-full">
        {pending && <Spinner label="Signing in" />}
        Sign in
      </Button>
    </form>
  );
}
