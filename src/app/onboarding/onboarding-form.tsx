"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Camera } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { UserAvatar } from "@/components/profile/user-avatar";
import { Button } from "@/components/ui/button";
import { FormField, FormMessage } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { Textarea } from "@/components/ui/textarea";
import { fromDatabaseError, toUserMessage } from "@/lib/errors";
import { uploadAvatar } from "@/lib/storage/avatar-upload";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { type ProfileInput, profileSchema } from "@/lib/validation/profile";

export function OnboardingForm({ userId, initialDisplayName }: { userId: string; initialDisplayName: string }) {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [checked, setChecked] = useState<{ value: string; available: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const form = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: { username: "", displayName: initialDisplayName, bio: "", statusText: "" },
  });
  const username = useWatch({ control: form.control, name: "username" });
  const displayName = useWatch({ control: form.control, name: "displayName" });

  const normalizedUsername = (username ?? "").trim().toLowerCase();
  const usernameValid = /^[a-z0-9_]{3,30}$/.test(normalizedUsername);
  const availability: "unknown" | "checking" | "available" | "taken" = !usernameValid
    ? "unknown"
    : checked?.value !== normalizedUsername
      ? "checking"
      : checked.available
        ? "available"
        : "taken";

  useEffect(() => {
    if (!usernameValid) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { data } = await supabase.rpc("is_username_available", { p_username: normalizedUsername });
      if (!cancelled) setChecked({ value: normalizedUsername, available: Boolean(data) });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [supabase, normalizedUsername, usernameValid]);

  // Revoke the last preview URL on unmount.
  const previewRef = useRef<string | null>(null);
  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  const chooseAvatar = (file: File | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = file ? URL.createObjectURL(file) : null;
    previewRef.current = url;
    setAvatarFile(file);
    setPreview(url);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    setSaving(true);
    try {
      const parsed = profileSchema.parse(values);
      let avatarPath: string | null = null;
      if (avatarFile) avatarPath = await uploadAvatar(avatarFile, `users/${userId}`);
      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          username: parsed.username,
          display_name: parsed.displayName,
          bio: parsed.bio || null,
          status_text: parsed.statusText || null,
          ...(avatarPath ? { avatar_path: avatarPath } : {}),
        })
        .eq("id", userId);
      if (updateError) throw fromDatabaseError(updateError, "Could not save your profile.");
      router.replace("/chats");
      router.refresh();
    } catch (e) {
      setError(toUserMessage(e));
      setSaving(false);
    }
  });

  const errors = form.formState.errors;
  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      <FormMessage>{error}</FormMessage>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="group relative rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label="Choose a profile photo"
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local blob preview
            <img src={preview} alt="" className="size-20 rounded-full object-cover" />
          ) : (
            <UserAvatar name={displayName} path={null} size="xl" />
          )}
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <Camera className="size-6 text-white" aria-hidden />
          </span>
        </button>
        <div className="text-sm text-muted-foreground">
          <p>Profile photo (optional)</p>
          <p className="text-xs">JPEG, PNG, WebP or GIF. Cropped to a square.</p>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => chooseAvatar(e.target.files?.[0] ?? null)}
        />
      </div>

      <FormField
        id="username"
        label="Username"
        error={errors.username?.message ?? (availability === "taken" ? "That username is already taken." : undefined)}
        description={availability === "available" ? "✓ Available" : "Lowercase letters, numbers and underscores. Others can find you by it."}
      >
        {(p) => <Input {...p} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus {...form.register("username")} />}
      </FormField>
      <FormField id="displayName" label="Display name" error={errors.displayName?.message}>
        {(p) => <Input {...p} autoComplete="name" {...form.register("displayName")} />}
      </FormField>
      <FormField id="statusText" label="Status (optional)" error={errors.statusText?.message}>
        {(p) => <Input {...p} placeholder="Available" {...form.register("statusText")} />}
      </FormField>
      <FormField id="bio" label="About (optional)" error={errors.bio?.message}>
        {(p) => <Textarea {...p} rows={3} {...form.register("bio")} />}
      </FormField>
      <Button type="submit" disabled={saving || availability === "taken"} className="w-full">
        {saving && <Spinner label="Saving" />}
        Continue
      </Button>
    </form>
  );
}
