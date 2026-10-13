"use client";

import { useQuery } from "@tanstack/react-query";
import { MessageSquarePlus, Search, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/components/providers/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConversations, useUpdatePreferences } from "@/hooks/use-conversations";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { type ConversationFilter, filterConversations, sortConversations } from "@/lib/chat/conversations";
import { formatListTimestamp } from "@/lib/chat/time";
import { fromDatabaseError } from "@/lib/errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { conversationTitle } from "@/types/chat";
import { BrandMark } from "../brand";
import { ConnectionBanner } from "./connection-banner";
import { ConversationListItem } from "./conversation-list-item";
import { NewChatDialog } from "./new-chat-dialog";
import { UserMenu } from "./user-menu";

const FILTERS: { id: ConversationFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "groups", label: "Groups" },
  { id: "direct", label: "Direct" },
  { id: "archived", label: "Archived" },
];

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function Sidebar() {
  const { userId } = useSession();
  const params = useParams<{ conversationId?: string }>();
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [query, setQuery] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const { data, isPending, isError, refetch } = useConversations();
  const updatePreferences = useUpdatePreferences();
  const now = useNow(60_000);

  const visible = useMemo(() => sortConversations(filterConversations(data ?? [], filter, query)), [data, filter, query]);
  const debouncedQuery = useDebouncedValue(query.trim(), 300);

  const messageResults = useQuery({
    queryKey: ["search", "all", debouncedQuery],
    enabled: debouncedQuery.length >= 2,
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient();
      const { data: rows, error } = await supabase.rpc("search_messages", { p_query: debouncedQuery, p_limit: 20 });
      if (error) throw fromDatabaseError(error, "Search failed.");
      return rows ?? [];
    },
  });
  const titleById = useMemo(() => new Map((data ?? []).map((c) => [c.id, conversationTitle(c)])), [data]);

  return (
    <div className="flex h-full min-h-0 flex-col pt-safe">
      <header className="flex items-center gap-3 px-3 py-3">
        <UserMenu />
        <BrandMark className="[&>span:first-child]:hidden" />
        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={() => setNewChatOpen(true)} aria-label="New chat">
                <MessageSquarePlus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New chat</TooltipContent>
          </Tooltip>
        </div>
      </header>
      <ConnectionBanner />

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats and messages"
            aria-label="Search chats and messages"
            className="bg-muted pl-9"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1" aria-label="Clear search">
              <X className="size-4" />
            </button>
          )}
        </div>
        <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto" role="tablist" aria-label="Filter conversations">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                filter === f.id ? "border-transparent bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto pb-safe" aria-label="Conversation list">
        {isPending && (
          <ul className="grid gap-1 px-3" aria-busy="true">
            {Array.from({ length: 7 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 py-2">
                <Skeleton className="size-10 rounded-full" />
                <span className="grid flex-1 gap-2">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="h-3 w-4/5" />
                </span>
              </li>
            ))}
          </ul>
        )}
        {isError && (
          <div className="grid justify-items-center gap-2 p-6 text-center text-sm" role="alert">
            <p className="text-muted-foreground">Couldn&apos;t load your conversations.</p>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        )}
        {data && visible.length === 0 && !query && (
          <div className="grid justify-items-center gap-3 p-8 text-center text-sm text-muted-foreground">
            <p>{filter === "archived" ? "No archived chats." : filter === "all" ? "No conversations yet." : "Nothing here."}</p>
            {filter === "all" && (
              <Button size="sm" onClick={() => setNewChatOpen(true)}>
                Start a conversation
              </Button>
            )}
          </div>
        )}
        {visible.length > 0 && (
          <ul aria-label="Conversations">
            {visible.map((c) => (
              <ConversationListItem
                key={c.id}
                conversation={c}
                active={params.conversationId === c.id}
                myUserId={userId}
                now={now}
                onUpdate={(patch) => updatePreferences.mutate({ conversationId: c.id, patch })}
              />
            ))}
          </ul>
        )}
        {debouncedQuery.length >= 2 && (
          <section className="border-t px-3 py-2" aria-label="Messages matching your search">
            <h2 className="py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Messages</h2>
            {messageResults.isPending && <Skeleton className="h-10" />}
            {messageResults.data?.length === 0 && <p className="py-2 text-sm text-muted-foreground">No messages found.</p>}
            <ul className="grid gap-1">
              {messageResults.data?.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/chats/${m.conversation_id}?message=${m.id}`}
                    className="block rounded-md px-2 py-2 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  >
                    <span className="flex items-baseline gap-2 text-xs text-muted-foreground">
                      <span className="truncate font-medium text-foreground">{titleById.get(m.conversation_id) ?? "Conversation"}</span>
                      <span className="ml-auto shrink-0">{formatListTimestamp(m.created_at)}</span>
                    </span>
                    <span className="line-clamp-2 text-sm">{m.content}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </nav>
      <NewChatDialog open={newChatOpen} onOpenChange={setNewChatOpen} />
    </div>
  );
}
