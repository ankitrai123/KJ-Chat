"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { Sidebar } from "./sidebar";

/**
 * Desktop: sidebar + conversation side by side. Mobile: one pane at a time — the list at
 * /chats, the conversation at /chats/[id] — so nothing overflows horizontally.
 */
export function ChatsShell({ children }: { children: React.ReactNode }) {
  const segment = useSelectedLayoutSegment();
  const inConversation = Boolean(segment);

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <aside
        className={cn(
          "w-full shrink-0 flex-col border-r bg-sidebar md:flex md:w-[340px] lg:w-[380px]",
          inConversation ? "hidden" : "flex",
        )}
        aria-label="Conversations"
      >
        <Sidebar />
      </aside>
      <main className={cn("min-w-0 flex-1 flex-col bg-chat md:flex", inConversation ? "flex" : "hidden")}>{children}</main>
    </div>
  );
}
