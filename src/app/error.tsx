"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Log only the error type and digest; never message contents or tokens.
    console.error("[ui] render error", error.name, error.digest ?? "");
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center" role="alert">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">An unexpected error occurred. Your messages are safe on the server.</p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        {/* A hard reload is intended here: it discards whatever client state crashed. */}
        {/* eslint-disable-next-line @next/next/no-location-assign-relative-destination */}
        <Button variant="outline" onClick={() => window.location.assign("/chats")}>
          Reload app
        </Button>
      </div>
    </main>
  );
}
