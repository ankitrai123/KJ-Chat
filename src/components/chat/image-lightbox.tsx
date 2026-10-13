"use client";

import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/misc";
import { useSignedUrl } from "@/hooks/use-signed-url";
import { createDownloadUrl } from "@/lib/storage/signed-urls";
import type { Attachment } from "@/types/chat";

export function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: Attachment[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const current = index === null ? null : images[index];
  const { url } = useSignedUrl("attachments", current?.storage_path);

  const go = useCallback(
    (delta: number) => {
      if (index === null) return;
      onIndexChange((index + delta + images.length) % images.length);
    },
    [images.length, index, onIndexChange],
  );

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index]);

  const download = async () => {
    if (!current) return;
    const link = await createDownloadUrl("attachments", current.storage_path, current.file_name);
    if (link) window.location.assign(link);
  };

  return (
    <Dialog open={index !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="flex h-dvh max-h-dvh w-screen max-w-none items-center justify-center rounded-none border-0 bg-black/95 p-0 sm:max-w-none">
        <DialogTitle className="sr-only">{current?.file_name ?? "Image"}</DialogTitle>
        <DialogDescription className="sr-only">
          Image {index !== null ? index + 1 : 0} of {images.length}. Use the arrow keys to browse.
        </DialogDescription>
        <div className="absolute top-0 right-0 left-0 z-10 flex items-center gap-2 p-3 text-white pt-safe">
          <span className="truncate text-sm">{current?.file_name}</span>
          <Button variant="ghost" size="icon" className="ml-auto text-white hover:bg-white/10" onClick={() => void download()} aria-label="Download image">
            <Download />
          </Button>
          <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- private signed URL, not optimisable
          <img src={url} alt={current?.file_name ?? ""} className="max-h-full max-w-full object-contain" />
        ) : (
          <Spinner className="text-white" label="Loading image" />
        )}
        {images.length > 1 && (
          <>
            <Button variant="ghost" size="icon-lg" className="absolute left-2 text-white hover:bg-white/10" onClick={() => go(-1)} aria-label="Previous image">
              <ChevronLeft />
            </Button>
            <Button variant="ghost" size="icon-lg" className="absolute right-2 text-white hover:bg-white/10" onClick={() => go(1)} aria-label="Next image">
              <ChevronRight />
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
