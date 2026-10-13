"use client";

import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatListTimestamp } from "@/lib/chat/time";
import { fromDatabaseError } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

function highlight(text: string, query: string) {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1 || !query) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded bg-warning/40 text-foreground">{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}

export function SearchPanel({
  conversationId,
  nameOf,
  onSelect,
}: {
  conversationId: string;
  nameOf: (userId: string | null) => string;
  onSelect: (messageId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query.trim(), 300);
  const { data, isFetching, isError } = useQuery({
    queryKey: queryKeys.search(debounced, conversationId),
    enabled: debounced.length >= 2,
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient();
      const { data: rows, error } = await supabase.rpc("search_messages", {
        p_query: debounced,
        p_conversation_id: conversationId,
        p_limit: 50,
      });
      if (error) throw fromDatabaseError(error, "Search failed.");
      return rows ?? [];
    },
  });

  return (
    <div className="grid gap-3 p-4">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search this conversation" aria-label="Search this conversation" className="pl-9" autoFocus />
      </div>
      {debounced.length < 2 && <p className="text-sm text-muted-foreground">Type at least 2 characters.</p>}
      {isFetching && <Skeleton className="h-12" />}
      {isError && <p className="text-sm text-destructive">Search failed. Check your connection.</p>}
      {data && data.length === 0 && debounced.length >= 2 && <p className="text-sm text-muted-foreground">No messages found.</p>}
      <ul className="grid gap-1" aria-label="Search results">
        {data?.map((m) => (
          <li key={m.id}>
            <button type="button" onClick={() => onSelect(m.id)} className="w-full rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
              <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate font-medium text-foreground">{nameOf(m.sender_id)}</span>
                <span>{formatListTimestamp(m.created_at)}</span>
              </span>
              <span className="line-clamp-3 text-sm">{highlight(m.content ?? "", debounced)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
