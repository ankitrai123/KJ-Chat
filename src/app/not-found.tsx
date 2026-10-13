import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">The page doesn&apos;t exist or you don&apos;t have access to it.</p>
      <Link href="/chats" className="text-sm font-medium text-primary underline underline-offset-4">
        Go to your chats
      </Link>
    </main>
  );
}
