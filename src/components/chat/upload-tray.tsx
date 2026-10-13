"use client";

import { FileText, Mic, Music, RotateCcw, Video, X } from "lucide-react";
import { formatBytes } from "@/lib/attachments/rules";
import { cn } from "@/lib/utils";
import type { UploadItem } from "@/hooks/use-uploads";

export function UploadTray({
  items,
  onRemove,
  onRetry,
}: {
  items: UploadItem[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  if (!items.length) return null;
  return (
    <ul className="flex gap-2 overflow-x-auto px-2 pt-2 pb-1" aria-label="Attachments to send">
      {items.map((item) => {
        const Icon = item.kind === "video" ? Video : item.kind === "audio" ? Music : item.kind === "voice" ? Mic : FileText;
        const percent = Math.round(item.progress * 100);
        return (
          <li key={item.id} className="relative w-28 shrink-0 overflow-hidden rounded-lg border bg-card">
            <div className="relative flex h-20 items-center justify-center bg-muted">
              {item.kind === "image" && item.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                <img src={item.previewUrl} alt="" className="size-full object-cover" />
              ) : (
                <Icon className="size-7 text-muted-foreground" aria-hidden />
              )}
              {item.status === "uploading" && (
                <div className="absolute inset-x-0 bottom-0 h-1 bg-black/10">
                  <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
                </div>
              )}
              {item.status === "error" && (
                <button
                  type="button"
                  onClick={() => onRetry(item.id)}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-destructive/80 text-xs font-medium text-white"
                  aria-label={`Retry uploading ${item.file.name}`}
                >
                  <RotateCcw className="size-4" aria-hidden />
                  Retry
                </button>
              )}
            </div>
            <div className="px-1.5 py-1">
              <p className="truncate text-xs font-medium" title={item.file.name}>
                {item.file.name}
              </p>
              <p className={cn("text-[11px] text-muted-foreground", item.status === "error" && "text-destructive")}>
                {item.status === "uploading" ? `${percent}%` : item.status === "error" ? (item.error ?? "Failed") : formatBytes(item.file.size)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
              aria-label={item.status === "uploading" ? `Cancel upload of ${item.file.name}` : `Remove ${item.file.name}`}
            >
              <X className="size-3" />
            </button>
            <span className="sr-only" role="status">
              {item.status === "uploading" ? `Uploading ${item.file.name}, ${percent}%` : item.status === "error" ? `Upload failed: ${item.file.name}` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
