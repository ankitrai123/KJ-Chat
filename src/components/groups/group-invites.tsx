"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fromDatabaseError, toUserMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatListTimestamp } from "@/lib/chat/time";

const EXPIRY_OPTIONS = [
  { hours: 1, label: "1 hour" },
  { hours: 24, label: "1 day" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
];

const USE_OPTIONS = [
  { value: "1", label: "1 use" },
  { value: "5", label: "5 uses" },
  { value: "25", label: "25 uses" },
  { value: "unlimited", label: "No limit" },
];

/** Invite links (admins only; RLS hides them from other members). */
export function GroupInvites({ conversationId }: { conversationId: string }) {
  const queryClient = useQueryClient();
  const supabase = getSupabaseBrowserClient();
  const [expiry, setExpiry] = useState("168");
  const [uses, setUses] = useState("unlimited");

  const invites = useQuery({
    queryKey: queryKeys.invites(conversationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("group_invites")
        .select("*")
        .eq("conversation_id", conversationId)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });
      if (error) throw fromDatabaseError(error);
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("create_group_invite", {
        p_conversation_id: conversationId,
        p_expires_in_hours: Number(expiry),
        p_max_uses: uses === "unlimited" ? null : Number(uses),
      });
      if (error) throw fromDatabaseError(error);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.invites(conversationId) }),
    onError: (e) => toast.error(toUserMessage(e)),
  });

  const revoke = useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase.rpc("revoke_group_invite", { p_invite_id: inviteId });
      if (error) throw fromDatabaseError(error);
    },
    onSuccess: () => {
      toast.success("Link revoked");
      void queryClient.invalidateQueries({ queryKey: queryKeys.invites(conversationId) });
    },
    onError: (e) => toast.error(toUserMessage(e)),
  });

  const copy = async (token: string) => {
    const link = `${window.location.origin}/join/${token}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Invite link copied");
    } catch {
      toast.message(link);
    }
  };

  return (
    <div className="grid gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Link2 className="size-4" aria-hidden /> Invite links
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={expiry} onValueChange={setExpiry}>
          <SelectTrigger className="w-28" aria-label="Link expires after">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPIRY_OPTIONS.map((o) => (
              <SelectItem key={o.hours} value={String(o.hours)}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={uses} onValueChange={setUses}>
          <SelectTrigger className="w-28" aria-label="Maximum uses">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {USE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}>
          Create link
        </Button>
      </div>
      {invites.isPending && <Skeleton className="h-10" />}
      <ul className="grid gap-2">
        {invites.data?.map((invite) => (
          <li key={invite.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-xs">…/join/{invite.token.slice(0, 10)}…</span>
              <span className="block text-xs text-muted-foreground">
                Expires {formatListTimestamp(invite.expires_at)} · {invite.use_count}
                {invite.max_uses ? `/${invite.max_uses}` : ""} used
              </span>
            </span>
            <Button size="icon-sm" variant="ghost" onClick={() => void copy(invite.token)} aria-label="Copy invite link">
              <Copy />
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => revoke.mutate(invite.id)} aria-label="Revoke invite link">
              <Trash2 className="text-destructive" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
