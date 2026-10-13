"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/components/providers/session-provider";
import { fromDatabaseError, toUserMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** The people I have blocked (who blocked me is private and never exposed). */
export function useBlocks() {
  const { userId } = useSession();
  return useQuery({
    queryKey: queryKeys.blocks,
    staleTime: 60_000,
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from("user_blocks")
        .select("blocked_id, created_at, profile:profiles!user_blocks_blocked_id_fkey(id, username, display_name, avatar_path)")
        .eq("blocker_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw fromDatabaseError(error);
      return data ?? [];
    },
  });
}

export function useIsBlocked(otherUserId: string | null | undefined) {
  const { data } = useBlocks();
  return Boolean(otherUserId && data?.some((b) => b.blocked_id === otherUserId));
}

export function useBlockActions() {
  const { userId } = useSession();
  const queryClient = useQueryClient();
  const block = useMutation({
    mutationFn: async (otherUserId: string) => {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.from("user_blocks").insert({ blocker_id: userId, blocked_id: otherUserId });
      if (error && error.code !== "23505") throw fromDatabaseError(error, "Could not block this user.");
    },
    onSuccess: () => toast.success("User blocked. They can no longer message or call you."),
    onError: (e) => toast.error(toUserMessage(e)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.blocks }),
  });
  const unblock = useMutation({
    mutationFn: async (otherUserId: string) => {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.from("user_blocks").delete().eq("blocker_id", userId).eq("blocked_id", otherUserId);
      if (error) throw fromDatabaseError(error, "Could not unblock this user.");
    },
    onSuccess: () => toast.success("User unblocked."),
    onError: (e) => toast.error(toUserMessage(e)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.blocks }),
  });
  return { block, unblock };
}
