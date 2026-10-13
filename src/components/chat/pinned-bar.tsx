"use client";

import { useQuery } from "@tanstack/react-query";
import { Pin } from "lucide-react";
import { useState } from "react";
import { fetchMessagesByIds } from "@/lib/chat/message-fetcher";
import { messagePreview } from "@/lib/chat/format";
import { fromDatabaseError } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function usePinnedMessages(conversationId: string) {
  return useQuery({
    queryKey: queryKeys.pins(conversationId),
    staleTime: 60_000,
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from("pinned_messages")
        .select("message_id, pinned_at, pinned_by")
        .eq("conversation_id", conversationId)
        .order("pinned_at", { ascending: false });
      if (error) throw fromDatabaseError(error);
      const ids = (data ?? []).map((p) => p.message_id);
      const messages = ids.length ? await fetchMessagesByIds(ids) : [];
      const byId = new Map(messages.map((m) => [m.id, m]));
      return ids.map((id) => byId.get(id)).filter((m) => m && !m.deleted_at) as NonNullable<ReturnType<typeof byId.get>>[];
    },
  });
}

/** Shows pinned messages newest-first; each click jumps to one and advances to the next. */
export function PinnedBar({ conversationId, onJump }: { conversationId: string; onJump: (messageId: string) => void }) {
  const { data } = usePinnedMessages(conversationId);
  const [index, setIndex] = useState(0);
  if (!data?.length) return null;
  const current = data[index % data.length];

  return (
    <button
      type="button"
      onClick={() => {
        onJump(current.id);
        setIndex((i) => (i + 1) % data.length);
      }}
      className="flex w-full items-center gap-3 border-b bg-background/95 px-4 py-2 text-left hover:bg-accent/50"
      aria-label={`Pinned message ${(index % data.length) + 1} of ${data.length}. Jump to it`}
    >
      <Pin className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-primary">
          Pinned message{data.length > 1 ? ` ${(index % data.length) + 1}/${data.length}` : ""}
        </span>
        <span className="block truncate text-sm text-muted-foreground">
          {messagePreview({ message_type: current.message_type, content: current.content, attachment_kind: current.attachments[0]?.kind })}
        </span>
      </span>
    </button>
  );
}
