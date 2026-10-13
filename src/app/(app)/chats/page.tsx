import { MessageSquareDashed } from "lucide-react";

export default function ChatsIndexPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <MessageSquareDashed className="size-12 text-muted-foreground" aria-hidden />
      <h1 className="text-lg font-semibold">Your conversations</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Pick a conversation from the list, or start a new one with the pencil button.
      </p>
    </div>
  );
}
