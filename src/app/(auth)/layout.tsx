import type * as React from "react";
import { BrandMark } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-chat px-4 py-10 pt-safe pb-safe">
      <div className="mb-8">
        <BrandMark />
      </div>
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm sm:p-8">{children}</div>
      <p className="mt-6 max-w-sm text-center text-xs text-muted-foreground">
        A private space for a small circle of people. Messages are encrypted in transit and at rest by our hosting
        providers; they are not end-to-end encrypted.
      </p>
    </main>
  );
}
