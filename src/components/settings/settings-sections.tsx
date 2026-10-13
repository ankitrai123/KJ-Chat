"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Camera, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { signOutEverywhereAction, updatePasswordAction } from "@/app/(auth)/actions";
import { useSession } from "@/components/providers/session-provider";
import { UserAvatar } from "@/components/profile/user-avatar";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner, Switch } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBlockActions, useBlocks } from "@/hooks/use-blocks";
import { apiFetch } from "@/lib/api-client";
import { isWebPushConfigured } from "@/lib/env";
import { toUserMessage } from "@/lib/errors";
import { disablePush, enablePush, isPushEnabled, pushSupport } from "@/lib/notifications/push.client";
import { deleteAvatarObject, uploadAvatar } from "@/lib/storage/avatar-upload";
import { type ResetPasswordInput, resetPasswordSchema } from "@/lib/validation/auth";
import { type ProfileInput, profileSchema } from "@/lib/validation/profile";

export function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 rounded-xl border bg-card p-5" aria-labelledby={`section-${title}`}>
      <div>
        <h2 id={`section-${title}`} className="text-base font-semibold">
          {title}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

export function ProfileSection() {
  const { userId, profile, updateProfile } = useSession();
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const form = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      username: profile.username ?? "",
      displayName: profile.display_name,
      bio: profile.bio ?? "",
      statusText: profile.status_text ?? "",
    },
  });

  const onAvatar = async (file: File | undefined) => {
    if (!file) return;
    setAvatarBusy(true);
    try {
      const previous = profile.avatar_path;
      const path = await uploadAvatar(file, `users/${userId}`);
      await updateProfile({ avatar_path: path });
      await deleteAvatarObject(previous).catch(() => undefined);
      toast.success("Profile photo updated");
    } catch (e) {
      toast.error(toUserMessage(e));
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = async () => {
    const previous = profile.avatar_path;
    try {
      await updateProfile({ avatar_path: null });
      await deleteAvatarObject(previous).catch(() => undefined);
    } catch (e) {
      toast.error(toUserMessage(e));
    }
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setSaving(true);
    try {
      const parsed = profileSchema.parse(values);
      await updateProfile({
        username: parsed.username,
        display_name: parsed.displayName,
        bio: parsed.bio || null,
        status_text: parsed.statusText || null,
      });
      toast.success("Profile saved");
    } catch (e) {
      toast.error(toUserMessage(e));
    } finally {
      setSaving(false);
    }
  });

  const errors = form.formState.errors;
  return (
    <Section title="Profile" description="How other people see you.">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="group relative rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label="Change profile photo"
          disabled={avatarBusy}
        >
          <UserAvatar name={profile.display_name} path={profile.avatar_path} size="xl" />
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            {avatarBusy ? <Spinner className="text-white" label="Uploading" /> : <Camera className="size-5 text-white" aria-hidden />}
          </span>
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => void onAvatar(e.target.files?.[0])} />
        {profile.avatar_path && (
          <Button variant="ghost" size="sm" onClick={() => void removeAvatar()}>
            Remove photo
          </Button>
        )}
      </div>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="displayName" label="Display name" error={errors.displayName?.message}>
            {(p) => <Input {...p} {...form.register("displayName")} />}
          </FormField>
          <FormField id="username" label="Username" error={errors.username?.message}>
            {(p) => <Input {...p} autoCapitalize="none" spellCheck={false} {...form.register("username")} />}
          </FormField>
        </div>
        <FormField id="statusText" label="Status" error={errors.statusText?.message}>
          {(p) => <Input {...p} placeholder="Available" {...form.register("statusText")} />}
        </FormField>
        <FormField id="bio" label="About" error={errors.bio?.message}>
          {(p) => <Textarea {...p} rows={3} {...form.register("bio")} />}
        </FormField>
        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving && <Spinner label="Saving" />}
            Save profile
          </Button>
        </div>
      </form>
    </Section>
  );
}

export function PrivacySection() {
  const { settings, updateSettings } = useSession();
  const save = (patch: Parameters<typeof updateSettings>[0]) => updateSettings(patch).catch((e) => toast.error(toUserMessage(e)));
  return (
    <Section title="Privacy" description="Control what other people can see about you.">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label htmlFor="last-seen">Last seen</Label>
          <p className="mt-1 text-xs text-muted-foreground">&quot;My contacts&quot; means people you share a conversation with.</p>
        </div>
        <Select value={settings.last_seen_visibility} onValueChange={(v) => void save({ last_seen_visibility: v as "everyone" | "contacts" | "nobody" })}>
          <SelectTrigger id="last-seen" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="everyone">Everyone</SelectItem>
            <SelectItem value="contacts">My contacts</SelectItem>
            <SelectItem value="nobody">Nobody</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <ToggleRow
        id="online-status"
        label="Show when I'm online"
        description="When off, you appear offline to everyone."
        checked={settings.show_online_status}
        onChange={(v) => void save({ show_online_status: v })}
      />
      <ToggleRow
        id="read-receipts"
        label="Read receipts"
        description="When off, others won't see when you've read their messages, and you won't see theirs."
        checked={settings.read_receipts_enabled}
        onChange={(v) => void save({ read_receipts_enabled: v })}
      />
    </Section>
  );
}

function usePermission(): NotificationPermission | "unsupported" {
  return useSyncExternalStore(
    (cb) => {
      const timer = setInterval(cb, 2000);
      return () => clearInterval(timer);
    },
    () => (typeof Notification === "undefined" ? "unsupported" : Notification.permission),
    () => "default",
  );
}

export function NotificationsSection() {
  const { settings, updateSettings } = useSession();
  const permission = usePermission();
  const [pushOn, setPushOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const support = typeof window === "undefined" ? "unsupported" : pushSupport();
  const save = (patch: Parameters<typeof updateSettings>[0]) => updateSettings(patch).catch((e) => toast.error(toUserMessage(e)));

  useEffect(() => {
    let cancelled = false;
    void isPushEnabled().then((on) => {
      if (!cancelled) setPushOn(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the stored timezone in sync with this device for quiet hours.
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && zone !== settings.timezone) void updateSettings({ timezone: zone }).catch(() => undefined);
  }, [settings.timezone, updateSettings]);

  const togglePush = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) await enablePush();
      else await disablePush();
      setPushOn(on);
      toast.success(on ? "Push notifications enabled on this device" : "Push notifications disabled on this device");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Notifications" description="Per-chat settings (mute, mentions only) are in each conversation's info panel.">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Browser notifications</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {permission === "granted"
              ? "Allowed on this device."
              : permission === "denied"
                ? "Blocked. Allow notifications for this site in your browser settings."
                : permission === "unsupported"
                  ? "Not supported by this browser."
                  : "Shown while this app is open in the background."}
          </p>
        </div>
        {permission === "default" && (
          <Button size="sm" variant="outline" onClick={() => void Notification.requestPermission()}>
            Allow
          </Button>
        )}
      </div>
      <ToggleRow
        id="push"
        label="Push notifications on this device"
        description={
          !isWebPushConfigured()
            ? "Not configured on this server."
            : support === "needs-install"
              ? "On iPhone/iPad, add this app to your Home Screen first (Share → Add to Home Screen)."
              : support === "unsupported"
                ? "Not supported by this browser."
                : "Get notified even when the app is closed. Delivery of incoming calls while closed is best-effort."
        }
        checked={Boolean(pushOn)}
        onChange={(v) => void togglePush(v)}
        disabled={busy || pushOn === null || support !== "supported" || !isWebPushConfigured()}
      />
      <ToggleRow id="notify-messages" label="Message notifications" checked={settings.notify_messages} onChange={(v) => void save({ notify_messages: v })} />
      <ToggleRow id="notify-calls" label="Call notifications" checked={settings.notify_calls} onChange={(v) => void save({ notify_calls: v })} />
      <ToggleRow
        id="previews"
        label="Show message previews"
        description="When off, notifications only say “New message”."
        checked={settings.notification_previews}
        onChange={(v) => void save({ notification_previews: v })}
      />
      <ToggleRow id="sound" label="Sounds" checked={settings.notification_sound} onChange={(v) => void save({ notification_sound: v })} />
      <ToggleRow
        id="quiet-hours"
        label="Quiet hours"
        description={`No message or call notifications during these hours (${settings.timezone}).`}
        checked={settings.quiet_hours_enabled}
        onChange={(v) => void save({ quiet_hours_enabled: v })}
      />
      {settings.quiet_hours_enabled && (
        <div className="flex flex-wrap items-center gap-3">
          <Label htmlFor="quiet-start">From</Label>
          <Input id="quiet-start" type="time" className="w-32" defaultValue={settings.quiet_hours_start.slice(0, 5)} onBlur={(e) => e.target.value && void save({ quiet_hours_start: e.target.value })} />
          <Label htmlFor="quiet-end">to</Label>
          <Input id="quiet-end" type="time" className="w-32" defaultValue={settings.quiet_hours_end.slice(0, 5)} onBlur={(e) => e.target.value && void save({ quiet_hours_end: e.target.value })} />
        </div>
      )}
    </Section>
  );
}

export function BlockedSection() {
  const { data, isPending } = useBlocks();
  const { unblock } = useBlockActions();
  return (
    <Section title="Blocked people" description="Blocked people can't message or call you, or start a chat with you.">
      {isPending ? (
        <Spinner />
      ) : !data?.length ? (
        <p className="text-sm text-muted-foreground">You haven&apos;t blocked anyone.</p>
      ) : (
        <ul className="grid gap-2">
          {data.map((b) => (
            <li key={b.blocked_id} className="flex items-center gap-3">
              <UserAvatar name={b.profile?.display_name} path={b.profile?.avatar_path} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{b.profile?.display_name ?? "Deleted account"}</span>
                {b.profile?.username && <span className="block text-xs text-muted-foreground">@{b.profile.username}</span>}
              </span>
              <Button size="sm" variant="outline" onClick={() => unblock.mutate(b.blocked_id)}>
                Unblock
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const options = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];
  return (
    <Section title="Appearance">
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
        {options.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            onClick={() => setTheme(value)}
            className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-sm ${theme === value ? "border-primary bg-primary/10" : "hover:bg-accent"}`}
          >
            <Icon className="size-5" aria-hidden />
            {label}
          </button>
        ))}
      </div>
    </Section>
  );
}

export function AccountSection() {
  const { email, profile } = useSession();
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const passwordForm = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema), defaultValues: { password: "", confirmPassword: "" } });

  const changePassword = passwordForm.handleSubmit(async (values) => {
    setSavingPassword(true);
    const result = await updatePasswordAction(values).catch(() => ({ ok: false as const, error: "Can't reach the server." }));
    setSavingPassword(false);
    if (result.ok) {
      toast.success("Password updated");
      passwordForm.reset();
    } else {
      toast.error(result.error);
    }
  });

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      await apiFetch("/api/account", { method: "DELETE", body: { confirmation } });
      toast.success("Your account has been deleted.");
      router.replace("/login");
      router.refresh();
    } catch (e) {
      toast.error(toUserMessage(e));
      setDeleting(false);
    }
  };

  return (
    <Section title="Account">
      <div className="text-sm">
        <span className="text-muted-foreground">Signed in as </span>
        <span className="font-medium">{email ?? profile.username}</span>
      </div>
      <form onSubmit={changePassword} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" noValidate>
        <FormField id="new-password" label="New password" error={passwordForm.formState.errors.password?.message}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...passwordForm.register("password")} />}
        </FormField>
        <FormField id="confirm-new-password" label="Confirm" error={passwordForm.formState.errors.confirmPassword?.message}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...passwordForm.register("confirmPassword")} />}
        </FormField>
        <Button type="submit" disabled={savingPassword}>
          {savingPassword && <Spinner label="Saving" />}
          Change password
        </Button>
      </form>
      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button variant="outline" onClick={() => void signOutEverywhereAction()}>
          <LogOut /> Sign out of all devices
        </Button>
        <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
          Delete account
        </Button>
      </div>
      <Dialog open={deleteOpen} onOpenChange={(open) => !deleting && setDeleteOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently deletes your profile, removes your photos and files, and replaces your messages with
              &quot;This message was deleted&quot;. Groups you own are handed to another member. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <FormField id="delete-confirmation" label='Type "DELETE" to confirm'>
            {(p) => <Input {...p} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" />}
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={confirmation !== "DELETE" || deleting} onClick={() => void deleteAccount()}>
              {deleting && <Spinner label="Deleting" />}
              Delete my account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
