import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminConsole } from "@/components/settings/admin-console";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Administration" };

export default async function AdminPage() {
  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  // RLS also restricts every admin query; this check only hides the page.
  const { data: admin } = userId ? await supabase.from("app_admins").select("user_id").eq("user_id", userId).maybeSingle() : { data: null };
  if (!admin) notFound();

  return (
    <div className="h-dvh overflow-y-auto bg-chat">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-3 py-3 pt-safe backdrop-blur">
        <Button asChild variant="ghost" size="icon">
          <Link href="/chats" aria-label="Back to chats">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">Administration</h1>
      </header>
      <main className="mx-auto grid max-w-3xl gap-4 p-4 pb-safe">
        <AdminConsole />
      </main>
    </div>
  );
}
