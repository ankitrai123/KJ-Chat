"use client";

import { Mic, Paperclip, Pencil, Reply, Send, Smile, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/profile/user-avatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toAttachmentInput, type useUploads } from "@/hooks/use-uploads";
import { ALLOWED_MIME_TYPES } from "@/lib/attachments/rules";
import { messagePreview } from "@/lib/chat/format";
import { cn } from "@/lib/utils";
import type { AttachmentInput } from "@/lib/validation/chat";
import { MAX_MESSAGE_LENGTH } from "@/lib/validation/chat";
import type { ChatMessage, MemberWithProfile } from "@/types/chat";
import { EmojiPicker } from "./emoji-picker";
import { UploadTray } from "./upload-tray";
import { VoiceRecorder } from "./voice-recorder";

const ACCEPT = Object.keys(ALLOWED_MIME_TYPES).join(",");
const draftKey = (conversationId: string) => `kj:draft:${conversationId}`;

function readDraft(conversationId: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(draftKey(conversationId)) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(conversationId: string, text: string) {
  try {
    if (text.trim()) window.localStorage.setItem(draftKey(conversationId), text);
    else window.localStorage.removeItem(draftKey(conversationId));
  } catch {
    // storage unavailable
  }
}

/** On touch keyboards Enter inserts a newline (send with the button), like most mobile chat apps. */
function enterSends(): boolean {
  return typeof window !== "undefined" && !window.matchMedia("(pointer: coarse)").matches;
}

export function Composer({
  conversationId,
  isGroup,
  members,
  myUserId,
  uploads,
  replyTo,
  editing,
  nameOf,
  onCancelReply,
  onCancelEdit,
  onSend,
  onEdit,
  onTyping,
}: {
  conversationId: string;
  isGroup: boolean;
  members: MemberWithProfile[];
  myUserId: string;
  uploads: ReturnType<typeof useUploads>;
  replyTo: ChatMessage | null;
  editing: ChatMessage | null;
  nameOf: (userId: string | null) => string;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onSend: (input: { content?: string; attachments?: AttachmentInput[] }) => Promise<unknown>;
  onEdit: (message: ChatMessage, content: string) => Promise<boolean>;
  onTyping: (typing: boolean) => void;
}) {
  const [text, setText] = useState(() => (editing ? (editing.content ?? "") : readDraft(conversationId)));
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mention, setMention] = useState<{ query: string; start: number; index: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [replyTo?.id, editing?.id]);

  useEffect(
    () => () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
      onTyping(false);
    },
    [onTyping],
  );

  const mentionCandidates = useMemo(() => {
    if (!mention || !isGroup) return [];
    const q = mention.query.toLowerCase();
    return members
      .filter((m) => m.user_id !== myUserId && m.profile?.username)
      .filter((m) => m.profile!.username!.startsWith(q) || m.profile!.display_name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [isGroup, members, mention, myUserId]);

  const updateMention = (value: string, caret: number) => {
    if (!isGroup) return;
    const before = value.slice(0, caret);
    const match = /(^|\s)@([A-Za-z0-9_]{0,30})$/.exec(before);
    setMention(match ? { query: match[2], start: caret - match[2].length - 1, index: 0 } : null);
  };

  const onChange = (value: string, caret: number) => {
    setText(value);
    updateMention(value, caret);
    if (!editing) {
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => writeDraft(conversationId, value), 400);
      onTyping(value.trim().length > 0);
    }
  };

  const insertAtCaret = (insert: string, replaceFrom?: number) => {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? text.length;
    const start = replaceFrom ?? caret;
    const next = text.slice(0, start) + insert + text.slice(caret);
    onChange(next, start + insert.length);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + insert.length, start + insert.length);
    });
  };

  const pickMention = (username: string) => {
    if (!mention) return;
    insertAtCaret(`@${username} `, mention.start);
    setMention(null);
  };

  const canSend = (text.trim().length > 0 || uploads.items.length > 0) && !sending && text.length <= MAX_MESSAGE_LENGTH;

  const submit = useCallback(async () => {
    if (!canSend) return;
    if (editing) {
      setSending(true);
      const ok = await onEdit(editing, text);
      setSending(false);
      if (ok) onCancelEdit();
      return;
    }
    setSending(true);
    try {
      let attachments: AttachmentInput[] = [];
      if (uploads.items.length) {
        try {
          attachments = (await uploads.waitForUploads()).map(toAttachmentInput);
        } catch {
          toast.error("Some files didn't upload. Retry or remove them, then send again.");
          return;
        }
      }
      const content = text;
      setText("");
      writeDraft(conversationId, "");
      uploads.clearSent();
      onCancelReply();
      onTyping(false);
      setMention(null);
      await onSend({ content, attachments });
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }, [canSend, conversationId, editing, onCancelEdit, onCancelReply, onEdit, onSend, onTyping, text, uploads]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && mentionCandidates.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setMention({ ...mention, index: (mention.index + delta + mentionCandidates.length) % mentionCandidates.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const choice = mentionCandidates[mention.index];
        if (choice?.profile?.username) pickMention(choice.profile.username);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === "Escape") {
      if (editing) onCancelEdit();
      else if (replyTo) onCancelReply();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && enterSends()) {
      e.preventDefault();
      void submit();
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length && !editing) {
      e.preventDefault();
      void uploads.addFiles(files);
    }
  };

  const banner = editing ?? replyTo;

  if (recording) {
    return (
      <div className="border-t bg-background pb-safe">
        <VoiceRecorder
          conversationId={conversationId}
          onClose={() => setRecording(false)}
          onSend={(attachment) => onSend({ attachments: [attachment] })}
        />
      </div>
    );
  }

  return (
    <div className="border-t bg-background pb-safe">
      {banner && (
        <div className="flex items-center gap-2 border-b px-3 py-2">
          {editing ? <Pencil className="size-4 shrink-0 text-primary" aria-hidden /> : <Reply className="size-4 shrink-0 text-primary" aria-hidden />}
          <div className="min-w-0 flex-1 border-l-4 border-primary pl-2">
            <p className="text-xs font-semibold text-primary">{editing ? "Editing message" : `Replying to ${nameOf(banner.sender_id)}`}</p>
            <p className="truncate text-sm text-muted-foreground">
              {messagePreview({ message_type: banner.message_type, content: banner.content, attachment_kind: banner.attachments[0]?.kind })}
            </p>
          </div>
          <Button size="icon-sm" variant="ghost" onClick={editing ? onCancelEdit : onCancelReply} aria-label={editing ? "Cancel editing" : "Cancel reply"}>
            <X />
          </Button>
        </div>
      )}

      {!editing && <UploadTray items={uploads.items} onRemove={uploads.remove} onRetry={uploads.retry} />}

      {mention && mentionCandidates.length > 0 && (
        <ul className="mx-2 mb-1 overflow-hidden rounded-lg border bg-popover shadow-md" role="listbox" aria-label="Mention someone">
          {mentionCandidates.map((m, i) => (
            <li key={m.user_id} role="option" aria-selected={i === mention.index}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => m.profile?.username && pickMention(m.profile.username)}
                className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm", i === mention.index && "bg-accent")}
              >
                <UserAvatar name={m.profile?.display_name} path={m.profile?.avatar_path} size="xs" />
                <span className="font-medium">{m.profile?.display_name}</span>
                <span className="text-muted-foreground">@{m.profile?.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-1 px-2 py-2">
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <Button size="icon" variant="ghost" aria-label="Insert emoji">
              <Smile />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" side="top" align="start">
            <EmojiPicker onSelect={(emoji) => insertAtCaret(emoji)} />
          </PopoverContent>
        </Popover>
        {!editing && (
          <>
            <Button size="icon" variant="ghost" onClick={() => fileRef.current?.click()} aria-label="Attach files">
              <Paperclip />
            </Button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length) void uploads.addFiles(files);
              }}
            />
          </>
        )}
        <label htmlFor={`composer-${conversationId}`} className="sr-only">
          Message
        </label>
        <textarea
          id={`composer-${conversationId}`}
          ref={textareaRef}
          value={text}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => onTyping(false)}
          rows={1}
          placeholder={editing ? "Edit message" : "Message"}
          className="field-sizing-content max-h-40 min-h-10 flex-1 resize-none rounded-2xl border border-input bg-card px-4 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
          aria-describedby={text.length > MAX_MESSAGE_LENGTH ? `composer-${conversationId}-limit` : undefined}
          enterKeyHint="send"
        />
        {canSend || editing ? (
          <Button size="icon" className="rounded-full" onClick={() => void submit()} disabled={!canSend} aria-label={editing ? "Save edit" : "Send message"}>
            {sending || uploads.uploading ? <Spinner label={uploads.uploading ? "Uploading" : "Sending"} /> : <Send />}
          </Button>
        ) : (
          <Button size="icon" className="rounded-full" onClick={() => setRecording(true)} aria-label="Record voice message">
            <Mic />
          </Button>
        )}
      </div>
      {text.length > MAX_MESSAGE_LENGTH && (
        <p id={`composer-${conversationId}-limit`} className="px-4 pb-2 text-xs text-destructive" role="alert">
          Message is {text.length - MAX_MESSAGE_LENGTH} characters over the {MAX_MESSAGE_LENGTH} limit.
        </p>
      )}
    </div>
  );
}
