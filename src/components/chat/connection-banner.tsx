"use client";

import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useRealtimeStatus } from "@/components/providers/realtime-provider";

/** Only surfaces after a short grace period so brief reconnects don't flash a warning. */
export function ConnectionBanner() {
  const status = useRealtimeStatus();
  const [visibleStatus, setVisibleStatus] = useState<typeof status | null>(null);

  useEffect(() => {
    if (status === "connected" || status === "connecting") {
      const timer = setTimeout(() => setVisibleStatus(null), 0);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => setVisibleStatus(status), 2500);
    return () => clearTimeout(timer);
  }, [status]);

  if (!visibleStatus) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b bg-warning/15 px-4 py-2 text-sm">
      <WifiOff className="size-4 shrink-0" aria-hidden />
      {visibleStatus === "offline"
        ? "You're offline. Messages will send when you reconnect."
        : "Reconnecting… new messages may be delayed."}
    </div>
  );
}
