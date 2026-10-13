"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import { fromDatabaseError, toUserMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Group membership/role mutations. Authorization is enforced by the database functions. */
export function useGroupActions(conversationId: string) {
  const queryClient = useQueryClient();

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.members(conversationId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
  }, [conversationId, queryClient]);

  const run = useCallback(
    async (fn: () => Promise<{ error: { code?: string; message?: string; hint?: string | null } | null }>, success?: string) => {
      try {
        const { error } = await fn();
        if (error) throw fromDatabaseError(error);
        if (success) toast.success(success);
        refresh();
        return true;
      } catch (e) {
        toast.error(toUserMessage(e));
        return false;
      }
    },
    [refresh],
  );

  const supabase = getSupabaseBrowserClient();

  return {
    addMembers: (userIds: string[]) =>
      run(async () => supabase.rpc("add_group_members", { p_conversation_id: conversationId, p_user_ids: userIds }), "Members added"),
    setRole: (userId: string, role: "owner" | "admin" | "member") =>
      run(
        async () => supabase.rpc("set_group_member_role", { p_conversation_id: conversationId, p_user_id: userId, p_role: role }),
        role === "owner" ? "Ownership transferred" : role === "admin" ? "Made admin" : "Admin rights removed",
      ),
    removeMember: async (userId: string) => {
      try {
        // Through the server so the person is also removed from any ongoing call.
        await apiFetch(`/api/groups/${conversationId}/members/${userId}`, { method: "DELETE" });
        toast.success("Removed from group");
        refresh();
        return true;
      } catch (e) {
        toast.error(toUserMessage(e));
        return false;
      }
    },
    update: (name: string, description: string) =>
      run(async () => supabase.rpc("update_group", { p_conversation_id: conversationId, p_name: name, p_description: description || null }), "Group updated"),
    setAvatar: (path: string | null) => run(async () => supabase.rpc("set_group_avatar", { p_conversation_id: conversationId, p_avatar_path: path })),
    leave: () => run(async () => supabase.rpc("leave_group", { p_conversation_id: conversationId }), "You left the group"),
    deleteGroup: async () => {
      try {
        await apiFetch(`/api/groups/${conversationId}`, { method: "DELETE" });
        toast.success("Group deleted");
        queryClient.removeQueries({ queryKey: queryKeys.messages(conversationId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
        return true;
      } catch (e) {
        toast.error(toUserMessage(e));
        return false;
      }
    },
  };
}
