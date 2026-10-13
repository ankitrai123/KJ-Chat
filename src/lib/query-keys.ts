export const queryKeys = {
  conversations: ["conversations"] as const,
  messages: (conversationId: string) => ["messages", conversationId] as const,
  members: (conversationId: string) => ["members", conversationId] as const,
  pins: (conversationId: string) => ["pins", conversationId] as const,
  media: (conversationId: string, kind: string) => ["media", conversationId, kind] as const,
  invites: (conversationId: string) => ["invites", conversationId] as const,
  lastSeen: (userId: string) => ["last-seen", userId] as const,
  profile: (userId: string) => ["profile", userId] as const,
  blocks: ["blocks"] as const,
  search: (query: string, conversationId: string | null) => ["search", conversationId, query] as const,
};
