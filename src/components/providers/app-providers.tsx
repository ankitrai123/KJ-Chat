"use client";

import { useEffect } from "react";
import type * as React from "react";
import { CallProvider } from "@/components/calls/call-provider";
import { NotificationProvider } from "@/components/providers/notification-provider";
import { outbox } from "@/lib/chat/outbox";
import type { Database } from "@/types/database";
import { PresenceProvider } from "./presence-provider";
import { QueryProvider } from "./query-provider";
import { RealtimeProvider } from "./realtime-provider";
import { SessionProvider } from "./session-provider";

export function AppProviders({
  userId,
  email,
  isAdmin,
  profile,
  settings,
  children,
}: {
  userId: string;
  email: string | null;
  isAdmin: boolean;
  profile: Database["public"]["Tables"]["profiles"]["Row"];
  settings: Database["public"]["Tables"]["user_settings"]["Row"];
  children: React.ReactNode;
}) {
  useEffect(() => {
    outbox.init(userId);
  }, [userId]);

  return (
    <QueryProvider>
      <SessionProvider userId={userId} email={email} isAdmin={isAdmin} initialProfile={profile} initialSettings={settings}>
        <RealtimeProvider userId={userId}>
          <PresenceProvider>
            <NotificationProvider>
              <CallProvider>{children}</CallProvider>
            </NotificationProvider>
          </PresenceProvider>
        </RealtimeProvider>
      </SessionProvider>
    </QueryProvider>
  );
}
