import { toMicros } from "./time";

export type ReceiptState = "pending" | "failed" | "sent" | "delivered" | "read";

interface ReceiptMember {
  user_id: string;
  last_read_at: string | null;
  last_delivered_at: string | null;
}

/**
 * Delivery state of one of my messages as shown by the ticks next to it.
 * - direct chats: state of the other member
 * - groups: "read"/"delivered" only once every other member has read/received it
 * When I disabled read receipts myself, I don't see other people's either (reciprocity).
 */
export function receiptState(
  message: { created_at: string; localStatus?: "pending" | "failed" | "sent" },
  members: ReceiptMember[],
  myUserId: string,
  options: { showReadReceipts: boolean } = { showReadReceipts: true },
): ReceiptState {
  if (message.localStatus === "pending") return "pending";
  if (message.localStatus === "failed") return "failed";

  const others = members.filter((m) => m.user_id !== myUserId);
  if (others.length === 0) return "sent";

  const createdAt = toMicros(message.created_at);
  const reached = (ts: string | null) => ts !== null && toMicros(ts) >= createdAt;

  if (options.showReadReceipts && others.every((m) => reached(m.last_read_at))) return "read";
  if (others.every((m) => reached(m.last_delivered_at) || reached(m.last_read_at))) return "delivered";
  return "sent";
}

/** Members (other than the sender) who have read a message, for the "Read by" list. */
export function readBy(message: { created_at: string; sender_id: string | null }, members: ReceiptMember[]): string[] {
  const createdAt = toMicros(message.created_at);
  return members
    .filter((m) => m.user_id !== message.sender_id && m.last_read_at !== null && toMicros(m.last_read_at) >= createdAt)
    .map((m) => m.user_id);
}
