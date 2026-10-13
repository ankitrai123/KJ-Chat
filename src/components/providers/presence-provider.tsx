"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState } from "react";
import type * as React from "react";
import { queryKeys } from "@/lib/query-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useSession } from "./session-provider";

const PresenceContext = createContext<ReadonlySet<string>>(new Set());

/**
 * Online presence over a private Realtime Presence channel. Users who hide their online
 * status don't track themselves, so they simply appear offline. "Last seen" is stored in the
 * database (privacy-filtered by RLS) and refreshed by a heartbeat while the app is visible.
 */
export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const { userId, settings } = useSession();
  const showOnline = settings.show_online_status;
  const [online, setOnline] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let disposed = false;
    const channel = supabase.channel("online", { config: { private: true, presence: { key: userId } } });

    channel.on("presence", { event: "sync" }, () => {
      if (disposed) return;
      setOnline(new Set(Object.keys(channel.presenceState())));
    });

    void supabase.realtime.setAuth().finally(() => {
      if (disposed) return;
      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED" && showOnline) {
          await channel.track({ user_id: userId, online_at: new Date().toISOString() });
        }
      });
    });

    const heartbeat = () => {
      if (document.visibilityState === "visible") void supabase.rpc("touch_last_seen");
    };
    heartbeat();
    const interval = setInterval(heartbeat, 60_000);
    const onVisibility = () => {
      // Record the moment the user leaves, so "last seen" is accurate.
      void supabase.rpc("touch_last_seen");
      if (!showOnline) return;
      if (document.visibilityState === "visible") void channel.track({ user_id: userId, online_at: new Date().toISOString() });
      else void channel.untrack();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      void supabase.removeChannel(channel);
    };
  }, [userId, showOnline]);

  return <PresenceContext value={online}>{children}</PresenceContext>;
}

export function useOnlineUsers() {
  return useContext(PresenceContext);
}

export function useIsOnline(userId: string | null | undefined) {
  const online = useContext(PresenceContext);
  return userId ? online.has(userId) : false;
}

/** Last-seen timestamp, or null when hidden by the user's privacy settings. */
export function useLastSeen(userId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.lastSeen(userId ?? "none"),
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.from("user_last_seen").select("last_seen_at").eq("user_id", userId!).maybeSingle();
      return data?.last_seen_at ?? null;
    },
  });
}
