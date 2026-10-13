"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton, Spinner } from "@/components/ui/misc";
import { useSignedUrl } from "@/hooks/use-signed-url";
import { fromDatabaseError } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Attachment } from "@/types/chat";
import { FileCard } from "./attachment-view";
import { ImageLightbox } from "./image-lightbox";
import { VoicePlayer } from "./voice-player";

type Tab = "media" | "files" | "audio";
const KINDS: Record<Tab, ("image" | "video" | "file" | "audio" | "voice")[]> = {
  media: ["image", "video"],
  files: ["file"],
  audio: ["audio", "voice"],
};

function VideoDialog({ attachment, onClose }: { attachment: Attachment | null; onClose: () => void }) {
  const { url } = useSignedUrl("attachments", attachment?.storage_path);
  return (
    <Dialog open={Boolean(attachment)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl bg-black p-2 sm:max-w-3xl">
        <DialogTitle className="sr-only">{attachment?.file_name ?? "Video"}</DialogTitle>
        {url ? <video src={url} controls autoPlay playsInline className="max-h-[80dvh] w-full" /> : <Spinner className="m-auto text-white" label="Loading video" />}
      </DialogContent>
    </Dialog>
  );
}

function Thumb({ attachment, onOpen }: { attachment: Attachment; onOpen: () => void }) {
  const { url } = useSignedUrl("attachments", attachment.storage_path);
  return (
    <button type="button" onClick={onOpen} className="aspect-square overflow-hidden rounded-md bg-muted" aria-label={`Open ${attachment.file_name}`}>
      {url &&
        (attachment.kind === "video" ? (
          <video src={url} preload="metadata" muted className="size-full object-cover" aria-hidden />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- private signed URL
          <img src={url} alt="" loading="lazy" className="size-full object-cover" />
        ))}
    </button>
  );
}

/** Media, documents and audio shared in a conversation (RLS: members only). */
export function SharedMedia({ conversationId, tab, clearedAt }: { conversationId: string; tab: Tab; clearedAt: string | null }) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [video, setVideo] = useState<Attachment | null>(null);
  const { data, isPending } = useQuery({
    queryKey: queryKeys.media(conversationId, tab),
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient();
      let query = supabase
        .from("attachments")
        .select("id, storage_path, file_name, mime_type, file_size, kind, width, height, duration_ms, waveform, created_at")
        .eq("conversation_id", conversationId)
        .in("kind", KINDS[tab])
        .order("created_at", { ascending: false })
        .limit(90);
      if (clearedAt) query = query.gt("created_at", clearedAt);
      const { data: rows, error } = await query;
      if (error) throw fromDatabaseError(error);
      return (rows ?? []).map((r) => ({ ...r, waveform: Array.isArray(r.waveform) ? (r.waveform as number[]) : null })) as Attachment[];
    },
  });

  if (isPending) return <Skeleton className="h-24" />;
  if (!data?.length) return <p className="py-6 text-center text-sm text-muted-foreground">Nothing shared yet.</p>;

  if (tab === "media") {
    const images = data.filter((a) => a.kind === "image");
    return (
      <>
        <div className="grid grid-cols-3 gap-1">
          {data.map((a) => (
            <Thumb
              key={a.id}
              attachment={a}
              onOpen={() => (a.kind === "image" ? setLightbox(images.indexOf(a)) : setVideo(a))}
            />
          ))}
        </div>
        <ImageLightbox images={images} index={lightbox} onIndexChange={setLightbox} onClose={() => setLightbox(null)} />
        <VideoDialog attachment={video} onClose={() => setVideo(null)} />
      </>
    );
  }

  if (tab === "audio") {
    return (
      <ul className="grid gap-2">
        {data.map((a) => (
          <li key={a.id} className="rounded-lg bg-muted/50 px-2">
            <VoicePlayer path={a.storage_path} durationMs={a.duration_ms} waveform={a.waveform} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="grid gap-2">
      {data.map((a) => (
        <li key={a.id}>
          <FileCard attachment={a} />
        </li>
      ))}
    </ul>
  );
}
