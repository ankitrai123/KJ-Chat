"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/profile/user-avatar";
import { Button } from "@/components/ui/button";
import { Skeleton, Spinner } from "@/components/ui/misc";
import { fromDatabaseError, toUserMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function JoinGroup({ token }: { token: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [joining, setJoining] = useState(false);
  const { data: preview, isPending, isError } = useQuery({
    queryKey: ["invite-preview", token],
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowserClient().rpc("get_group_invite_preview", { p_token: token });
      if (error) throw fromDatabaseError(error);
      return data?.[0] ?? null;
    },
  });

  const join = async () => {
    setJoining(true);
    try {
      const { data, error } = await getSupabaseBrowserClient().rpc("join_group_via_invite", { p_token: token });
      if (error) throw fromDatabaseError(error);
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      router.replace(`/chats/${data}`);
    } catch (e) {
      toast.error(toUserMessage(e));
      setJoining(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-chat p-4">
      <div className="grid w-full max-w-sm justify-items-center gap-4 rounded-xl border bg-card p-6 text-center shadow-sm">
        {isPending ? (
          <>
            <Skeleton className="size-28 rounded-full" />
            <Skeleton className="h-5 w-40" />
          </>
        ) : isError || !preview ? (
          <>
            <h1 className="text-lg font-semibold">Invite link unavailable</h1>
            <p className="text-sm text-muted-foreground">This link is invalid, has expired, or has been revoked. Ask a group admin for a new one.</p>
            <Button asChild variant="outline">
              <Link href="/chats">Back to chats</Link>
            </Button>
          </>
        ) : (
          <>
            <UserAvatar name={preview.name} path={null} size="2xl" isGroup />
            <div>
              <h1 className="text-xl font-semibold">{preview.name}</h1>
              <p className="text-sm text-muted-foreground">{preview.member_count} members</p>
            </div>
            {preview.description && <p className="text-sm">{preview.description}</p>}
            {preview.is_member ? (
              <Button asChild>
                <Link href={`/chats/${preview.conversation_id}`}>Open group</Link>
              </Button>
            ) : (
              <Button onClick={() => void join()} disabled={joining} className="w-full">
                {joining && <Spinner label="Joining" />}
                Join group
              </Button>
            )}
          </>
        )}
      </div>
    </main>
  );
}
