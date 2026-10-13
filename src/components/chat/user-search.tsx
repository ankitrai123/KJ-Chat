"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Search } from "lucide-react";
import { useState } from "react";
import { UserAvatar } from "@/components/profile/user-avatar";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { fromDatabaseError } from "@/lib/errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export interface SearchResultUser {
  id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  status_text: string | null;
  is_blocked: boolean;
}

export function useUserSearch(query: string) {
  const debounced = useDebouncedValue(query.trim(), 250);
  return useQuery({
    queryKey: ["user-search", debounced],
    enabled: debounced.length >= 1,
    staleTime: 30_000,
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.rpc("search_profiles", { p_query: debounced, p_limit: 20 });
      if (error) throw fromDatabaseError(error, "Search failed.");
      return data ?? [];
    },
  });
}

/** Search box + result list; single-select (onPick) or multi-select (selected/onToggle). */
export function UserSearch({
  onPick,
  selected,
  onToggle,
  excludeIds = [],
  autoFocus = true,
}: {
  onPick?: (user: SearchResultUser) => void;
  selected?: ReadonlySet<string>;
  onToggle?: (user: SearchResultUser) => void;
  excludeIds?: string[];
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const { data, isFetching, isError } = useUserSearch(query);
  const results = (data ?? []).filter((u) => !excludeIds.includes(u.id));

  return (
    <div className="grid gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or username"
          aria-label="Search people"
          className="pl-9"
          autoFocus={autoFocus}
        />
      </div>
      <div className="max-h-72 overflow-y-auto" role="listbox" aria-label="People" aria-multiselectable={Boolean(onToggle)}>
        {isFetching && !data && (
          <div className="grid gap-2 p-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        )}
        {isError && <p className="p-3 text-sm text-destructive">Search failed. Check your connection.</p>}
        {query.trim() && data && results.length === 0 && <p className="p-3 text-sm text-muted-foreground">No people found.</p>}
        {!query.trim() && <p className="p-3 text-sm text-muted-foreground">Type a name or @username to find people.</p>}
        {results.map((user) => {
          const isSelected = selected?.has(user.id) ?? false;
          return (
            <button
              key={user.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              disabled={user.is_blocked}
              onClick={() => (onToggle ? onToggle(user) : onPick?.(user))}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50",
                isSelected && "bg-accent",
              )}
            >
              <UserAvatar name={user.display_name} path={user.avatar_path} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{user.display_name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  @{user.username}
                  {user.is_blocked ? " · blocked" : user.status_text ? ` · ${user.status_text}` : ""}
                </span>
              </span>
              {isSelected && <Check className="size-4 text-primary" aria-hidden />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
