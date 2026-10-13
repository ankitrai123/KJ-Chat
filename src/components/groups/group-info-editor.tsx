"use client";

import { Camera } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/profile/user-avatar";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { Textarea } from "@/components/ui/textarea";
import { useGroupActions } from "@/hooks/use-group-actions";
import { toUserMessage } from "@/lib/errors";
import { uploadAvatar } from "@/lib/storage/avatar-upload";
import type { ConversationSummary } from "@/types/chat";

export function GroupAvatarButton({ conversation, canEdit }: { conversation: ConversationSummary; canEdit: boolean }) {
  const actions = useGroupActions(conversation.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const path = await uploadAvatar(file, `groups/${conversation.id}`);
      await actions.setAvatar(path);
    } catch (e) {
      toast.error(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const avatar = <UserAvatar name={conversation.name} path={conversation.avatar_path} size="2xl" isGroup />;
  if (!canEdit) return avatar;
  return (
    <>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="group relative rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        aria-label="Change group photo"
        disabled={busy}
      >
        {avatar}
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          {busy ? <Spinner className="text-white" label="Uploading" /> : <Camera className="size-6 text-white" aria-hidden />}
        </span>
      </button>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
    </>
  );
}

export function GroupInfoEditor({ conversation, onDone }: { conversation: ConversationSummary; onDone: () => void }) {
  const actions = useGroupActions(conversation.id);
  const [name, setName] = useState(conversation.name ?? "");
  const [description, setDescription] = useState(conversation.description ?? "");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const ok = await actions.update(name.trim(), description.trim());
        setBusy(false);
        if (ok) onDone();
      }}
    >
      <FormField id="edit-group-name" label="Group name">
        {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />}
      </FormField>
      <FormField id="edit-group-description" label="Description">
        {(p) => <Textarea {...p} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={3} />}
      </FormField>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy && <Spinner label="Saving" />}
          Save
        </Button>
      </div>
    </form>
  );
}
