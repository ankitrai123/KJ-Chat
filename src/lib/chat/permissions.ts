import type { ChatMessage } from "@/types/chat";

/**
 * Which actions to offer in the UI. These mirror the checks in the database functions
 * (edit_message, delete_message, pin_message, remove_group_member, set_group_member_role,
 * update_group), which remain the actual security boundary.
 */

export type MemberRole = "owner" | "admin" | "member";

export const EDIT_WINDOW_MS = 48 * 3600 * 1000;

type MessageLike = Pick<ChatMessage, "message_type" | "deleted_at" | "created_at"> & {
  localStatus?: ChatMessage["localStatus"];
};

const isLocal = (message: MessageLike) => message.localStatus === "pending" || message.localStatus === "failed";

export function isGroupAdmin(role: MemberRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function canEditMessage(message: MessageLike, isMine: boolean, now: number): boolean {
  if (!isMine || message.deleted_at || isLocal(message)) return false;
  if (message.message_type === "system" || message.message_type === "call" || message.message_type === "voice") return false;
  return now - Date.parse(message.created_at) < EDIT_WINDOW_MS;
}

export function canDeleteForEveryone(message: MessageLike, isMine: boolean, isGroup: boolean, myRole: MemberRole | null | undefined): boolean {
  if (message.deleted_at || message.message_type === "system") return false;
  return isMine || (isGroup && isGroupAdmin(myRole));
}

export function canPinMessages(isGroup: boolean, myRole: MemberRole | null | undefined): boolean {
  return !isGroup || isGroupAdmin(myRole);
}

export function canEditGroupInfo(myRole: MemberRole | null | undefined): boolean {
  return isGroupAdmin(myRole);
}

export interface MemberActions {
  remove: boolean;
  promote: boolean;
  demote: boolean;
  transferOwnership: boolean;
}

/** What `myRole` may do to another member with `targetRole`. Nobody manages themselves here (use "Leave group"). */
export function memberActions(myRole: MemberRole | null | undefined, targetRole: MemberRole, isMe: boolean): MemberActions {
  const none = { remove: false, promote: false, demote: false, transferOwnership: false };
  if (isMe || !isGroupAdmin(myRole)) return none;
  const owner = myRole === "owner";
  return {
    remove: targetRole === "member" || (targetRole === "admin" && owner),
    promote: targetRole === "member",
    demote: targetRole === "admin" && owner,
    transferOwnership: owner,
  };
}
