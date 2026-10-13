import { AlertCircle, Check, CheckCheck, Clock } from "lucide-react";
import type { ReceiptState } from "@/lib/chat/receipts";
import { cn } from "@/lib/utils";

const LABELS: Record<ReceiptState, string> = {
  pending: "Sending",
  failed: "Not sent",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
};

export function ReadStatus({ state, className }: { state: ReceiptState; className?: string }) {
  const label = LABELS[state];
  const icon =
    state === "pending" ? (
      <Clock className="size-3.5" />
    ) : state === "failed" ? (
      <AlertCircle className="size-3.5 text-destructive" />
    ) : state === "sent" ? (
      <Check className="size-3.5" />
    ) : (
      <CheckCheck className={cn("size-3.5", state === "read" && "text-sky-600 dark:text-sky-400")} />
    );
  return (
    <span className={cn("inline-flex items-center", className)} role="img" aria-label={label} title={label}>
      {icon}
    </span>
  );
}
