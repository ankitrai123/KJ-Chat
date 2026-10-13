"use client";

import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/profile/user-avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { useConversations } from "@/hooks/use-conversations";
import { apiFetch } from "@/lib/api-client";
import { filterConversations, sortConversations } from "@/lib/chat/conversations";
import { toUserMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { type ChatMessage, conversationTitle } from "@/types/chat";

export function ForwardDialog({ message, onClose }: { message: ChatMessage | null; onClose: () => void }) {
  const { data } = useConversations();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => sortConversations(filterConversations(data ?? [], "all", query)), [data, query]);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 5) next.add(id);
      else toast.info("You can forward to up to 5 chats at once.");
      return next;
    });

  const forward = async () => {
    if (!message) return;
    setBusy(true);
    const results = await Promise.allSettled(
      Array.from(selected).map((conversationId) =>
        apiFetch("/api/messages", {
          method: "POST",
          body: { conversationId, clientId: crypto.randomUUID(), forwardFromMessageId: message.id },
        }),
      ),
    );
    setBusy(false);
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length) toast.error(toUserMessage((failed[0] as PromiseRejectedResult).reason));
    if (failed.length < results.length) toast.success(`Forwarded to ${results.length - failed.length} chat${results.length - failed.length > 1 ? "s" : ""}`);
    setSelected(new Set());
    onClose();
  };

  return (
    <Dialog open={Boolean(message)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Forward message</DialogTitle>
          <DialogDescription>Choose up to 5 chats.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search chats" className="pl-9" autoFocus />
        </div>
        <ul className="max-h-72 overflow-y-auto" role="listbox" aria-multiselectable aria-label="Chats">
          {list.map((c) => {
            const isSelected = selected.has(c.id);
            const title = conversationTitle(c);
            return (
              <li key={c.id} role="option" aria-selected={isSelected}>
                <button
                  type="button"
                  onClick={() => toggle(c.id)}
                  className={cn("flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent", isSelected && "bg-accent")}
                >
                  <UserAvatar name={title} path={c.type === "group" ? c.avatar_path : c.peer?.avatar_path} isGroup={c.type === "group"} size="sm" />
                  <span className="flex-1 truncate text-sm font-medium">{title}</span>
                  {isSelected && <Check className="size-4 text-primary" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void forward()} disabled={!selected.size || busy}>
            {busy && <Spinner label="Forwarding" />}
            Forward
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
