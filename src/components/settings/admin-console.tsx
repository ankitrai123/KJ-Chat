"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { UserSearch } from "@/components/chat/user-search";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Badge, Skeleton, Spinner, Switch } from "@/components/ui/misc";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatListTimestamp } from "@/lib/chat/time";
import { fromDatabaseError, toUserMessage } from "@/lib/errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Section } from "./settings-sections";

const keys = {
  settings: ["admin", "settings"] as const,
  invitations: ["admin", "invitations"] as const,
  reports: ["admin", "reports"] as const,
  admins: ["admin", "admins"] as const,
};

function withExpiry<T extends { expires_at: string | null }>(rows: T[]): (T & { expired: boolean })[] {
  const now = Date.now();
  return rows.map((row) => ({ ...row, expired: Boolean(row.expires_at && Date.parse(row.expires_at) < now) }));
}

/** Every query here is additionally restricted to administrators by RLS / function checks. */
export function AdminConsole() {
  return (
    <>
      <RegistrationSection />
      <InvitationsSection />
      <ReportsSection />
      <AdminsSection />
    </>
  );
}

function RegistrationSection() {
  const supabase = getSupabaseBrowserClient();
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: keys.settings,
    queryFn: async () => {
      const { data: row, error } = await supabase.from("app_settings").select("*").single();
      if (error) throw fromDatabaseError(error);
      return row;
    },
  });
  const setMode = useMutation({
    mutationFn: async (mode: "open" | "invite") => {
      const { error } = await supabase.rpc("admin_set_registration_mode", { p_mode: mode });
      if (error) throw fromDatabaseError(error);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.settings }),
    onError: (e) => toast.error(toUserMessage(e)),
  });

  return (
    <Section title="Registration" description="Invite-only mode is enforced by the database, not just this screen.">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label htmlFor="invite-only">Invite-only registration</Label>
          <p className="mt-1 text-xs text-muted-foreground">When off, anyone with the link can create an account.</p>
        </div>
        <Switch
          id="invite-only"
          checked={data?.registration_mode !== "open"}
          disabled={!data || setMode.isPending}
          onCheckedChange={(checked) => setMode.mutate(checked ? "invite" : "open")}
        />
      </div>
    </Section>
  );
}

function InvitationsSection() {
  const supabase = getSupabaseBrowserClient();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [hours, setHours] = useState("168");
  const [uses, setUses] = useState("1");

  const { data, isPending } = useQuery({
    queryKey: keys.invitations,
    queryFn: async () => {
      const { data: rows, error } = await supabase.from("app_invitations").select("*").order("created_at", { ascending: false }).limit(50);
      if (error) throw fromDatabaseError(error);
      return withExpiry(rows ?? []);
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data: invite, error } = await supabase.rpc("admin_create_app_invitation", {
        p_email: email || null,
        p_note: note || null,
        p_expires_in_hours: Number(hours),
        p_max_uses: Number(uses),
      });
      if (error) throw fromDatabaseError(error);
      return invite;
    },
    onSuccess: (invite) => {
      setEmail("");
      setNote("");
      void copyLink(invite.code);
      void queryClient.invalidateQueries({ queryKey: keys.invitations });
    },
    onError: (e) => toast.error(toUserMessage(e)),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("admin_revoke_app_invitation", { p_invitation_id: id });
      if (error) throw fromDatabaseError(error);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.invitations }),
    onError: (e) => toast.error(toUserMessage(e)),
  });

  const copyLink = async (code: string) => {
    const link = `${window.location.origin}/register?invite=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Invitation link copied");
    } catch {
      toast.message(link);
    }
  };

  return (
    <Section title="Invitations" description="Share a link so someone can register while invite-only mode is on.">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <FormField id="invite-email" label="Restrict to email (optional)">
          {(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </FormField>
        <FormField id="invite-note" label="Note (optional)">
          {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="For Alex" />}
        </FormField>
        <div className="flex items-end gap-2">
          <Select value={hours} onValueChange={setHours}>
            <SelectTrigger aria-label="Expires after">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24">Expires in 1 day</SelectItem>
              <SelectItem value="168">Expires in 7 days</SelectItem>
              <SelectItem value="720">Expires in 30 days</SelectItem>
            </SelectContent>
          </Select>
          <Select value={uses} onValueChange={setUses}>
            <SelectTrigger aria-label="Maximum uses">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 use</SelectItem>
              <SelectItem value="5">5 uses</SelectItem>
              <SelectItem value="20">20 uses</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end justify-end">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending && <Spinner label="Creating" />}
            Create invitation
          </Button>
        </div>
      </form>
      {isPending && <Skeleton className="h-16" />}
      <ul className="grid gap-2">
        {data?.map((invite) => {
          const expired = invite.expired;
          const exhausted = invite.use_count >= invite.max_uses;
          const active = !invite.revoked_at && !expired && !exhausted;
          return (
            <li key={invite.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{invite.note || invite.email || "Invitation"}</span>
                <span className="block text-xs text-muted-foreground">
                  {invite.use_count}/{invite.max_uses} used · created {formatListTimestamp(invite.created_at)}
                  {invite.email ? ` · ${invite.email} only` : ""}
                </span>
              </span>
              {active ? <Badge>Active</Badge> : <Badge variant="secondary">{invite.revoked_at ? "Revoked" : exhausted ? "Used" : "Expired"}</Badge>}
              {active && (
                <>
                  <Button size="icon-sm" variant="ghost" onClick={() => void copyLink(invite.code)} aria-label="Copy invitation link">
                    <Copy />
                  </Button>
                  <Button size="icon-sm" variant="ghost" onClick={() => revoke.mutate(invite.id)} aria-label="Revoke invitation">
                    <Trash2 className="text-destructive" />
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function ReportsSection() {
  const supabase = getSupabaseBrowserClient();
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: keys.reports,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("user_reports")
        .select(
          "*, reporter:profiles!user_reports_reporter_id_fkey(display_name, username), reported:profiles!user_reports_reported_user_id_fkey(display_name, username)",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw fromDatabaseError(error);
      return rows ?? [];
    },
  });
  const update = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "open" | "reviewed" | "dismissed" }) => {
      const { error } = await supabase.rpc("admin_update_report", { p_report_id: id, p_status: status });
      if (error) throw fromDatabaseError(error);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.reports }),
    onError: (e) => toast.error(toUserMessage(e)),
  });

  return (
    <Section title="Reports" description="Reports about users or messages. Message contents are not copied into reports.">
      {isPending && <Skeleton className="h-16" />}
      {data?.length === 0 && <p className="text-sm text-muted-foreground">No reports.</p>}
      <ul className="grid gap-2">
        {data?.map((r) => (
          <li key={r.id} className="grid gap-1 rounded-md border px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={r.status === "open" ? "destructive" : "secondary"}>{r.status}</Badge>
              <span className="font-medium">{r.reason}</span>
              <span className="text-muted-foreground">
                about {r.reported?.display_name ?? "deleted account"} {r.reported?.username ? `(@${r.reported.username})` : ""}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">{formatListTimestamp(r.created_at)}</span>
            </div>
            {r.details && <p className="text-muted-foreground">{r.details}</p>}
            <p className="text-xs text-muted-foreground">Reported by {r.reporter?.display_name ?? "deleted account"}</p>
            <div className="flex gap-2">
              {r.status !== "reviewed" && (
                <Button size="sm" variant="outline" onClick={() => update.mutate({ id: r.id, status: "reviewed" })}>
                  Mark reviewed
                </Button>
              )}
              {r.status !== "dismissed" && (
                <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: r.id, status: "dismissed" })}>
                  Dismiss
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function AdminsSection() {
  const supabase = getSupabaseBrowserClient();
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: keys.admins,
    queryFn: async () => {
      const { data: rows, error } = await supabase.from("app_admins").select("user_id, created_at, profile:profiles(display_name, username)");
      if (error) throw fromDatabaseError(error);
      return rows ?? [];
    },
  });
  const setAdmin = useMutation({
    mutationFn: async ({ userId, isAdmin }: { userId: string; isAdmin: boolean }) => {
      const { error } = await supabase.rpc("admin_set_app_admin", { p_user_id: userId, p_is_admin: isAdmin });
      if (error) throw fromDatabaseError(error);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.admins }),
    onError: (e) => toast.error(toUserMessage(e)),
  });

  return (
    <Section title="Administrators" description="Administrators can manage registration, invitations and reports.">
      <ul className="grid gap-2">
        {data?.map((a) => (
          <li key={a.user_id} className="flex items-center gap-3 text-sm">
            <span className="flex-1">
              {a.profile?.display_name} {a.profile?.username && <span className="text-muted-foreground">@{a.profile.username}</span>}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setAdmin.mutate({ userId: a.user_id, isAdmin: false })}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <details>
        <summary className="cursor-pointer text-sm font-medium">Add an administrator</summary>
        <div className="pt-3">
          <UserSearch autoFocus={false} excludeIds={data?.map((a) => a.user_id)} onPick={(u) => setAdmin.mutate({ userId: u.id, isAdmin: true })} />
        </div>
      </details>
    </Section>
  );
}
