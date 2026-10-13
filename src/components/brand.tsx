import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        <MessageCircle className="size-5" aria-hidden />
      </span>
      <span className="text-lg">KJ Chat</span>
    </span>
  );
}
