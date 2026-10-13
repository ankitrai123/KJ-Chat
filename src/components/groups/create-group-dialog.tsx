"use client";

import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { type SearchResultUser, UserSearch } from "@/components/chat/user-search";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Badge, Spinner } from "@/components/ui/misc";
import { Textarea } from "@/components/ui/textarea";
import { fromDatabaseError, toUserMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { createGroupSchema } from "@/lib/validation/chat";

export function CreateGroupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [members, setMembers] = useState<SearchResultUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (user: SearchResultUser) =>
    setMembers((list) => (list.some((u) => u.id === user.id) ? list.filter((u) => u.id !== user.id) : [...list, user]));

  const reset = () => {
    setName("");
    setDescription("");
    setMembers([]);
    setError(null);
  };

  const create = async () => {
    const parsed = createGroupSchema.safeParse({ name, description, memberIds: members.map((m) => m.id) });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the group details.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error: rpcError } = await supabase.rpc("create_group", {
        p_name: parsed.data.name,
        p_description: parsed.data.description || null,
        p_member_ids: parsed.data.memberIds,
      });
      if (rpcError) throw fromDatabaseError(rpcError, "Could not create the group.");
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      reset();
      onOpenChange(false);
      toast.success("Group created");
      router.push(`/chats/${data}`);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New group</DialogTitle>
          <DialogDescription>Name the group and add people. You can add more later.</DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <FormField id="group-name" label="Group name">
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />}
        </FormField>
        <FormField id="group-description" label="Description (optional)">
          {(p) => <Textarea {...p} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} />}
        </FormField>
        {members.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Selected members">
            {members.map((m) => (
              <Badge key={m.id} variant="secondary" className="gap-1 py-1 pr-1">
                {m.display_name}
                <button type="button" onClick={() => toggle(m)} aria-label={`Remove ${m.display_name}`} className="rounded-full p-0.5 hover:bg-background">
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <UserSearch selected={new Set(members.map((m) => m.id))} onToggle={toggle} autoFocus={false} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void create()} disabled={busy || !name.trim()}>
            {busy && <Spinner label="Creating" />}
            Create group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
