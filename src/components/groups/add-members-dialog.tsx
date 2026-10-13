"use client";

import { useState } from "react";
import { type SearchResultUser, UserSearch } from "@/components/chat/user-search";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/misc";

export function AddMembersDialog({
  open,
  onOpenChange,
  existingIds,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingIds: string[];
  onAdd: (userIds: string[]) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<SearchResultUser[]>([]);
  const [busy, setBusy] = useState(false);
  const toggle = (u: SearchResultUser) => setSelected((list) => (list.some((x) => x.id === u.id) ? list.filter((x) => x.id !== u.id) : [...list, u]));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSelected([]);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add members</DialogTitle>
          <DialogDescription>{selected.length ? `${selected.length} selected` : "Search for people to add."}</DialogDescription>
        </DialogHeader>
        <UserSearch selected={new Set(selected.map((s) => s.id))} onToggle={toggle} excludeIds={existingIds} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!selected.length || busy}
            onClick={async () => {
              setBusy(true);
              const ok = await onAdd(selected.map((s) => s.id));
              setBusy(false);
              if (ok) {
                setSelected([]);
                onOpenChange(false);
              }
            }}
          >
            {busy && <Spinner label="Adding" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
