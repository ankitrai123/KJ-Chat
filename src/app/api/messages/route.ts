import { after } from "next/server";
import { verifyAttachment, type VerifiedAttachment } from "@/lib/attachments/verify.server";
import { buildAttachmentPath } from "@/lib/attachments/rules";
import { AppError, fromDatabaseError } from "@/lib/errors";
import { notifyNewMessage } from "@/lib/notifications/push.server";
import { requireUser } from "@/lib/security/auth";
import { jsonError, jsonOk, parseJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ServerSupabase } from "@/lib/supabase/server";
import { sendMessageSchema } from "@/lib/validation/chat";
import type { Json } from "@/types/database";

/**
 * Sends a message. The only write path for messages:
 *   session verified -> input validated -> rate limited -> attachments verified (or forwarded
 *   attachments copied under the user's own permissions) -> persisted by send_message()
 *   (service-role only, membership/block checks inside) -> response -> push notifications.
 * The message is durable before anyone is told about it; realtime delivery follows the commit.
 */
export async function POST(request: Request) {
  try {
    const { userId, supabase } = await requireUser(request);
    const input = await parseJson(request, sendMessageSchema);
    await enforceRateLimit("sendMessage", userId);
    const admin = getSupabaseAdminClient();

    let content = input.content;
    let attachments: VerifiedAttachment[] = [];
    let isForwarded = false;

    if (input.forwardFromMessageId) {
      const forwarded = await prepareForward(supabase, input.forwardFromMessageId, input.conversationId, userId);
      content = forwarded.content;
      attachments = forwarded.attachments;
      isForwarded = true;
    } else if (input.attachments.length) {
      attachments = await Promise.all(
        input.attachments.map((a) => verifyAttachment(admin, a, { conversationId: input.conversationId, userId })),
      );
    }

    const { data: message, error } = await admin.rpc("send_message", {
      p_sender_id: userId,
      p_conversation_id: input.conversationId,
      p_client_id: input.clientId,
      p_content: content ?? null,
      p_reply_to_message_id: input.replyToMessageId ?? null,
      p_attachments: attachments as unknown as Json,
      p_is_forwarded: isForwarded,
    });
    if (error) throw fromDatabaseError(error, "Could not send the message.");

    // Read back as the user so the response has exactly what they're allowed to see.
    const { data: details, error: detailsError } = await supabase.rpc("get_messages_by_ids", { p_ids: [message.id] });
    if (detailsError || !details?.[0]) throw fromDatabaseError(detailsError, "Message sent, but could not be loaded.");

    after(async () => {
      try {
        await notifyNewMessage(admin, message);
      } catch (pushError) {
        console.error("[push] message notification failed:", pushError instanceof Error ? pushError.name : "unknown");
      }
    });

    return jsonOk({ message: details[0] }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Forwarding copies the source attachments into the target conversation using the *user's*
 * storage permissions, which proves they can read the source and write to the target.
 */
async function prepareForward(supabase: ServerSupabase, sourceId: string, targetConversationId: string, userId: string) {
  const { data, error } = await supabase.rpc("get_messages_by_ids", { p_ids: [sourceId] });
  if (error) throw fromDatabaseError(error);
  const source = data?.[0];
  if (!source || source.deleted_at || source.message_type === "system" || source.message_type === "call") {
    throw new AppError("not_found", "That message can no longer be forwarded.");
  }

  const sourceAttachments = Array.isArray(source.attachments) ? (source.attachments as Record<string, unknown>[]) : [];
  const attachments: VerifiedAttachment[] = [];
  for (const attachment of sourceAttachments) {
    const fileName = String(attachment.file_name ?? "file");
    const target = buildAttachmentPath(targetConversationId, userId, crypto.randomUUID(), fileName);
    const { error: copyError } = await supabase.storage.from("attachments").copy(String(attachment.storage_path), target);
    if (copyError) throw new AppError("forbidden", "You can't forward this attachment to that conversation.");
    attachments.push({
      path: target,
      kind: attachment.kind as VerifiedAttachment["kind"],
      file_name: fileName,
      mime_type: String(attachment.mime_type),
      file_size: Number(attachment.file_size),
      width: typeof attachment.width === "number" ? attachment.width : undefined,
      height: typeof attachment.height === "number" ? attachment.height : undefined,
      duration_ms: typeof attachment.duration_ms === "number" ? attachment.duration_ms : undefined,
      waveform: Array.isArray(attachment.waveform) ? (attachment.waveform as number[]) : undefined,
    });
  }
  return { content: source.content ?? undefined, attachments };
}
