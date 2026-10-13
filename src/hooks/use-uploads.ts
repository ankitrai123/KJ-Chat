"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/components/providers/session-provider";
import { buildAttachmentPath, MAX_ATTACHMENTS_PER_MESSAGE, validateAttachmentFile } from "@/lib/attachments/rules";
import { deleteOwnUpload, type UploadHandle, uploadAttachment } from "@/lib/attachments/upload";
import { publicEnv } from "@/lib/env";
import { toUserMessage } from "@/lib/errors";
import { imageDimensions, mediaMetadata } from "@/lib/media/image";
import type { AttachmentInput } from "@/lib/validation/chat";

export interface UploadItem {
  id: string;
  file: File;
  path: string;
  mimeType: string;
  kind: AttachmentInput["kind"];
  progress: number;
  status: "uploading" | "done" | "error";
  error?: string;
  previewUrl?: string;
  meta: Pick<AttachmentInput, "width" | "height" | "durationMs" | "waveform">;
}

export function toAttachmentInput(item: UploadItem): AttachmentInput {
  return {
    path: item.path,
    fileName: item.file.name.slice(0, 255) || "file",
    mimeType: item.mimeType,
    size: item.file.size,
    kind: item.kind,
    ...item.meta,
  };
}

/**
 * Upload tray for the composer. Files upload as soon as they're picked so sending is instant;
 * each item can be cancelled (aborting the request and deleting the object) or retried.
 */
export function useUploads(conversationId: string) {
  const { userId } = useSession();
  const [items, setItems] = useState<UploadItem[]>([]);
  const handles = useRef(new Map<string, UploadHandle>());
  // Synchronous source of truth (updated only in callbacks) so waitForUploads() never reads a
  // stale render; React state mirrors it for rendering.
  const itemsRef = useRef<UploadItem[]>([]);

  const commit = useCallback((updater: (list: UploadItem[]) => UploadItem[]) => {
    itemsRef.current = updater(itemsRef.current);
    setItems(itemsRef.current);
  }, []);

  const patch = useCallback(
    (id: string, changes: Partial<UploadItem> | ((item: UploadItem) => Partial<UploadItem>)) => {
      commit((list) => list.map((item) => (item.id === id ? { ...item, ...(typeof changes === "function" ? changes(item) : changes) } : item)));
    },
    [commit],
  );

  // Resolves once an upload's final status has been written to itemsRef.
  const settled = useRef(new Map<string, Promise<void>>());

  const start = useCallback(
    (item: UploadItem) => {
      const handle = uploadAttachment(item.path, item.file, item.mimeType, (progress) => patch(item.id, { progress }));
      handles.current.set(item.id, handle);
      const done = handle.promise
        .then(
          () => patch(item.id, { status: "done", progress: 1 }),
          (error) => {
            if (!handles.current.has(item.id)) return; // cancelled by the user
            patch(item.id, { status: "error", error: toUserMessage(error) });
          },
        )
        .finally(() => {
          handles.current.delete(item.id);
          settled.current.delete(item.id);
        });
      settled.current.set(item.id, done);
    },
    [patch],
  );

  const addFiles = useCallback(
    async (files: File[], options: { kind?: "voice"; meta?: UploadItem["meta"] } = {}) => {
      const room = MAX_ATTACHMENTS_PER_MESSAGE - itemsRef.current.length;
      if (files.length > room) {
        toast.error(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`);
      }
      const accepted: UploadItem[] = [];
      for (const file of files.slice(0, Math.max(0, room))) {
        const check = validateAttachmentFile(file, publicEnv.maxAttachmentMb * 1024 * 1024);
        if (!check.ok || !check.mimeType || !check.kind) {
          toast.error(check.error ?? "This file can't be sent.");
          continue;
        }
        const id = crypto.randomUUID();
        const kind = options.kind ?? check.kind;
        const item: UploadItem = {
          id,
          file,
          path: buildAttachmentPath(conversationId, userId, id, file.name),
          mimeType: check.mimeType,
          kind,
          progress: 0,
          status: "uploading",
          previewUrl: kind === "image" || kind === "video" ? URL.createObjectURL(file) : undefined,
          meta: options.meta ?? {},
        };
        accepted.push(item);
      }
      if (!accepted.length) return [];
      commit((list) => [...list, ...accepted]);
      accepted.forEach(start);

      // Dimensions/duration are optional hints for layout; read them without blocking upload.
      for (const item of accepted) {
        if (item.kind === "image") {
          void imageDimensions(item.file).then((d) => d && patch(item.id, (current) => ({ meta: { ...current.meta, ...d } })));
        } else if (item.kind === "video" || item.kind === "audio") {
          void mediaMetadata(item.file, item.kind).then((m) => patch(item.id, (current) => ({ meta: { ...current.meta, ...m } })));
        }
      }
      return accepted.map((i) => i.id);
    },
    [commit, conversationId, patch, start, userId],
  );

  const remove = useCallback((id: string) => {
    const item = itemsRef.current.find((i) => i.id === id);
    const handle = handles.current.get(id);
    handles.current.delete(id);
    handle?.abort();
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    // Uploaded but never sent: remove the object (allowed only while unattached).
    if (item?.status === "done") void deleteOwnUpload(item.path).catch(() => undefined);
    commit((list) => list.filter((i) => i.id !== id));
  }, [commit]);

  const retry = useCallback(
    (id: string) => {
      const item = itemsRef.current.find((i) => i.id === id);
      if (!item) return;
      // New object name: a previous attempt may have reached storage even if the response was lost.
      const path = buildAttachmentPath(conversationId, userId, crypto.randomUUID(), item.file.name);
      const fresh = { ...item, path, status: "uploading" as const, progress: 0, error: undefined };
      patch(id, fresh);
      start(fresh);
    },
    [conversationId, patch, start, userId],
  );

  /** Called after a successful send: the objects now belong to the message, so keep them. */
  const clearSent = useCallback(() => {
    for (const item of itemsRef.current) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    commit(() => []);
  }, [commit]);

  /** Waits for in-flight uploads; resolves with the finished items or rejects on any failure. */
  const waitForUploads = useCallback(async (ids?: string[]) => {
    const pending = itemsRef.current.filter((i) => (!ids || ids.includes(i.id)) && i.status === "uploading");
    await Promise.all(pending.map((i) => settled.current.get(i.id)));
    const relevant = itemsRef.current.filter((i) => !ids || ids.includes(i.id));
    if (relevant.some((i) => i.status !== "done")) throw new Error("Some files failed to upload.");
    return relevant;
  }, []);

  // Abandon the tray when leaving the conversation.
  useEffect(() => {
    const handleMap = handles.current;
    return () => {
      for (const handle of handleMap.values()) handle.abort();
      for (const item of itemsRef.current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        if (item.status === "done") void deleteOwnUpload(item.path).catch(() => undefined);
      }
    };
  }, [conversationId]);

  const uploading = items.some((i) => i.status === "uploading");
  const failed = items.some((i) => i.status === "error");
  return { items, addFiles, remove, retry, clearSent, waitForUploads, uploading, failed };
}
