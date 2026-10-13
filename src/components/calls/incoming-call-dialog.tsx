"use client";

import { useQuery } from "@tanstack/react-query";
import { Phone, PhoneOff, Video } from "lucide-react";
import { UserAvatar } from "@/components/profile/user-avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { queryKeys } from "@/lib/query-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { CallState } from "@/lib/calls/state";
import { type ConversationSummary, conversationTitle } from "@/types/chat";

export function IncomingCallDialog({
  state,
  conversation,
  onAccept,
  onDecline,
}: {
  state: CallState;
  conversation: ConversationSummary | null;
  onAccept: (withVideo: boolean) => void;
  onDecline: () => void;
}) {
  const { data: caller } = useQuery({
    queryKey: queryKeys.profile(state.callerId ?? "none"),
    enabled: Boolean(state.callerId),
    queryFn: async () => {
      const { data } = await getSupabaseBrowserClient().from("profiles").select("id, display_name, avatar_path").eq("id", state.callerId!).maybeSingle();
      return data;
    },
  });
  const isGroup = conversation?.type === "group";
  const title = isGroup ? (conversation ? conversationTitle(conversation) : "Group call") : (caller?.display_name ?? "Incoming call");
  const kind = state.mediaType === "video" ? "video" : "voice";

  return (
    <Dialog open onOpenChange={(open) => !open && onDecline()}>
      <DialogContent showCloseButton={false} className="max-w-sm text-center sm:max-w-sm" onInteractOutside={(e) => e.preventDefault()}>
        <div className="grid justify-items-center gap-3 py-2">
          <span className="relative">
            <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" aria-hidden />
            <UserAvatar name={title} path={isGroup ? conversation?.avatar_path : caller?.avatar_path} size="2xl" isGroup={isGroup} />
          </span>
          <DialogTitle className="text-xl">{title}</DialogTitle>
          <DialogDescription>
            {isGroup ? `${caller?.display_name ?? "Someone"} is starting a group ${kind} call` : `Incoming ${kind} call…`}
          </DialogDescription>
        </div>
        <div className="flex items-center justify-center gap-6 pt-2">
          <div className="grid justify-items-center gap-1">
            <Button size="icon-lg" variant="destructive" className="rounded-full" onClick={onDecline} aria-label="Decline call">
              <PhoneOff />
            </Button>
            <span className="text-xs text-muted-foreground">Decline</span>
          </div>
          <div className="grid justify-items-center gap-1">
            <Button size="icon-lg" className="rounded-full bg-success text-white hover:bg-success/90" onClick={() => onAccept(false)} aria-label="Accept with audio only" autoFocus>
              <Phone />
            </Button>
            <span className="text-xs text-muted-foreground">{state.mediaType === "video" ? "Audio" : "Accept"}</span>
          </div>
          {state.mediaType === "video" && (
            <div className="grid justify-items-center gap-1">
              <Button size="icon-lg" className="rounded-full bg-success text-white hover:bg-success/90" onClick={() => onAccept(true)} aria-label="Accept with video">
                <Video />
              </Button>
              <span className="text-xs text-muted-foreground">Video</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
