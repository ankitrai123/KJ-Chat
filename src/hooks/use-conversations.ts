"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/components/providers/session-provider";
import { fromDatabaseError, toUserMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { type ConversationSummary, type MemberWithProfile, normalizeConversation } from "@/types/chat";

export function useConversations() {
  return useQuery({
    queryKey: queryKeys.conversations,
    staleTime: 15_000,
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.rpc("get_conversations");
      if (error) throw fromDatabaseError(error, "Could not load your conversations.");
      return (data ?? []).map(normalizeConversation);
    },
  });
}

export function useConversation(conversationId: string) {
  const query = useConversations();
  return { ...query, conversation: query.data?.find((c) => c.id === conversationId) ?? null };
}

export function useMembers(conversationId: string | null) {
  return useQuery({
    queryKey: queryKeys.members(conversationId ?? "none"),
    enabled: Boolean(conversationId),
    staleTime: 60_000,
    queryFn: async (): Promise<MemberWithProfile[]> => {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from("conversation_members")
        .select(
          "conversation_id, user_id, role, joined_at, last_read_at, last_delivered_at, profile:profiles!conversation_members_user_id_fkey(id, username, display_name, avatar_path, status_text, bio)",
        )
        .eq("conversation_id", conversationId!);
      if (error) throw fromDatabaseError(error, "Could not load members.");
      const roleOrder = { owner: 0, admin: 1, member: 2 } as const;
      return (data ?? [])
        .map((row) => ({ ...row, profile: row.profile ?? null }))
        .sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || (a.profile?.display_name ?? "").localeCompare(b.profile?.display_name ?? ""));
    },
  });
}

type PreferencePatch = Partial<Pick<ConversationSummary, "muted_until" | "archived_at" | "pinned_at" | "notification_level">>;

/** Archive, pin, mute and notification level: optimistic, rolled back on failure. */
export function useUpdatePreferences() {
  const queryClient = useQueryClient();
  const { userId } = useSession();
  return useMutation({
    mutationFn: async ({ conversationId, patch }: { conversationId: string; patch: PreferencePatch }) => {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from("conversation_preferences")
        .update(patch)
        .eq("conversation_id", conversationId)
        .eq("user_id", userId);
      if (error) throw fromDatabaseError(error, "Could not update this conversation.");
    },
    onMutate: async ({ conversationId, patch }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.conversations });
      const previous = queryClient.getQueryData<ConversationSummary[]>(queryKeys.conversations);
      queryClient.setQueryData<ConversationSummary[]>(queryKeys.conversations, (list) =>
        list?.map((c) => (c.id === conversationId ? { ...c, ...patch } : c)),
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.conversations, context.previous);
      toast.error(toUserMessage(error));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.conversations }),
  });
}

export function useClearConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.rpc("clear_conversation", { p_conversation_id: conversationId });
      if (error) throw fromDatabaseError(error);
    },
    onSuccess: (_data, conversationId) => {
      queryClient.removeQueries({ queryKey: queryKeys.messages(conversationId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
    onError: (error) => toast.error(toUserMessage(error)),
  });
}

export async function openDirectConversation(otherUserId: string): Promise<string> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("get_or_create_direct_conversation", { p_other_user_id: otherUserId });
  if (error) throw fromDatabaseError(error, "Could not open the conversation.");
  return data;
}
