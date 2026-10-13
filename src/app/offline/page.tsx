import { WifiOff } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline" };

/** Served by the service worker when a page can't be loaded without a connection. */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-chat p-6 text-center">
      <WifiOff className="size-12 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold">You&apos;re offline</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        KJ Chat needs a connection to load your conversations. Reconnect and this page will work again.
      </p>
      {/* Full navigation on purpose: this page is served by the service worker while offline. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/chats" className="text-sm font-medium text-primary underline underline-offset-4">
        Try again
      </a>
    </main>
  );
}
