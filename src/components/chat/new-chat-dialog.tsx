"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { CreateGroupDialog } from "@/components/groups/create-group-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { openDirectConversation } from "@/hooks/use-conversations";
import { toUserMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { UserSearch } from "./user-search";

export function NewChatDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);

  const start = async (userId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const conversationId = await openDirectConversation(userId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      onOpenChange(false);
      router.push(`/chats/${conversationId}`);
    } catch (error) {
      toast.error(toUserMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New chat</DialogTitle>
            <DialogDescription>Start a private conversation or create a group.</DialogDescription>
          </DialogHeader>
          <Button
            variant="outline"
            className="justify-start"
            onClick={() => {
              onOpenChange(false);
              setGroupOpen(true);
            }}
          >
            <Users aria-hidden />
            New group
          </Button>
          <UserSearch onPick={(u) => void start(u.id)} />
        </DialogContent>
      </Dialog>
      <CreateGroupDialog open={groupOpen} onOpenChange={setGroupOpen} />
    </>
  );
}
