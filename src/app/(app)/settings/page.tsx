import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  AccountSection,
  AppearanceSection,
  BlockedSection,
  NotificationsSection,
  PrivacySection,
  ProfileSection,
} from "@/components/settings/settings-sections";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="h-dvh overflow-y-auto bg-chat">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-3 py-3 pt-safe backdrop-blur">
        <Button asChild variant="ghost" size="icon">
          <Link href="/chats" aria-label="Back to chats">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">Settings</h1>
      </header>
      <main className="mx-auto grid max-w-2xl gap-4 p-4 pb-safe">
        <ProfileSection />
        <PrivacySection />
        <NotificationsSection />
        <AppearanceSection />
        <BlockedSection />
        <AccountSection />
      </main>
    </div>
  );
}
