"use client";

import { Download, FileText, ImageOff } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/misc";
import { useSignedUrl } from "@/hooks/use-signed-url";
import { formatBytes } from "@/lib/attachments/rules";
import { createDownloadUrl } from "@/lib/storage/signed-urls";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/types/chat";
import { ImageLightbox } from "./image-lightbox";
import { VoicePlayer } from "./voice-player";

function ImageTile({ attachment, onOpen, className }: { attachment: Attachment; onOpen: () => void; className?: string }) {
  const { url, failed } = useSignedUrl("attachments", attachment.storage_path);
  const ratio = attachment.width && attachment.height ? attachment.width / attachment.height : 4 / 3;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn("relative block overflow-hidden rounded-lg bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none", className)}
      style={{ aspectRatio: String(Math.min(Math.max(ratio, 0.5), 2)) }}
      aria-label={`Open image ${attachment.file_name}`}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- private signed URL
        <img src={url} alt={attachment.file_name} className="size-full object-cover" loading="lazy" decoding="async" />
      ) : failed ? (
        <span className="flex size-full items-center justify-center text-muted-foreground">
          <ImageOff className="size-6" aria-label="Image unavailable" />
        </span>
      ) : (
        <span className="flex size-full items-center justify-center">
          <Spinner label="Loading image" />
        </span>
      )}
    </button>
  );
}

function VideoAttachment({ attachment }: { attachment: Attachment }) {
  const { url } = useSignedUrl("attachments", attachment.storage_path);
  const ratio = attachment.width && attachment.height ? attachment.width / attachment.height : 16 / 9;
  return (
    <div className="overflow-hidden rounded-lg bg-black" style={{ aspectRatio: String(Math.min(Math.max(ratio, 0.5), 2)) }}>
      {url ? (
        <video src={url} controls preload="metadata" playsInline className="size-full" aria-label={attachment.file_name} />
      ) : (
        <span className="flex size-full items-center justify-center text-white">
          <Spinner label="Loading video" />
        </span>
      )}
    </div>
  );
}

function AudioAttachment({ attachment }: { attachment: Attachment }) {
  const { url } = useSignedUrl("attachments", attachment.storage_path);
  return (
    <div className="grid gap-1">
      <span className="truncate text-xs opacity-80">{attachment.file_name}</span>
      {url ? <audio src={url} controls preload="metadata" className="w-64 max-w-full" /> : <Spinner label="Loading audio" />}
    </div>
  );
}

export function FileCard({ attachment }: { attachment: Attachment }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    const url = await createDownloadUrl("attachments", attachment.storage_path, attachment.file_name);
    setBusy(false);
    if (!url) {
      toast.error("This file is no longer available.");
      return;
    }
    window.location.assign(url);
  };
  return (
    <button
      type="button"
      onClick={() => void download()}
      className="flex w-64 max-w-full items-center gap-3 rounded-lg bg-black/5 p-2.5 text-left hover:bg-black/10 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none dark:bg-white/5 dark:hover:bg-white/10"
      aria-label={`Download ${attachment.file_name}, ${formatBytes(attachment.file_size)}`}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
        <FileText className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{attachment.file_name}</span>
        <span className="block text-xs opacity-70">
          {formatBytes(attachment.file_size)} · {attachment.file_name.split(".").pop()?.toUpperCase()}
        </span>
      </span>
      {busy ? <Spinner label="Preparing download" /> : <Download className="size-4 shrink-0 opacity-70" aria-hidden />}
    </button>
  );
}

export function AttachmentView({ attachments, tone }: { attachments: Attachment[]; tone: "in" | "out" }) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const images = attachments.filter((a) => a.kind === "image");
  const others = attachments.filter((a) => a.kind !== "image");
  const shown = images.slice(0, 4);

  return (
    <div className="grid gap-1.5">
      {images.length > 0 && (
        <div className={cn("grid gap-1", shown.length > 1 ? "w-72 max-w-full grid-cols-2" : "w-72 max-w-full")}>
          {shown.map((image, i) => (
            <div key={image.id} className="relative">
              <ImageTile attachment={image} onOpen={() => setLightbox(i)} />
              {i === 3 && images.length > 4 && (
                <button
                  type="button"
                  onClick={() => setLightbox(3)}
                  className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50 text-xl font-semibold text-white"
                  aria-label={`View ${images.length - 4} more images`}
                >
                  +{images.length - 4}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {others.map((attachment) => {
        switch (attachment.kind) {
          case "video":
            return (
              <div key={attachment.id} className="w-72 max-w-full">
                <VideoAttachment attachment={attachment} />
              </div>
            );
          case "voice":
            return (
              <VoicePlayer
                key={attachment.id}
                path={attachment.storage_path}
                durationMs={attachment.duration_ms}
                waveform={attachment.waveform}
                tone={tone}
              />
            );
          case "audio":
            return <AudioAttachment key={attachment.id} attachment={attachment} />;
          default:
            return <FileCard key={attachment.id} attachment={attachment} />;
        }
      })}
      <ImageLightbox images={images} index={lightbox} onIndexChange={setLightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}
