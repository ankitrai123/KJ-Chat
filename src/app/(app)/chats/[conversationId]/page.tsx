import { notFound } from "next/navigation";
import { ConversationView } from "@/components/chat/conversation-view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  if (!UUID.test(conversationId)) notFound();
  // Keyed so all per-conversation state resets when switching chats.
  return <ConversationView key={conversationId} conversationId={conversationId} />;
}
