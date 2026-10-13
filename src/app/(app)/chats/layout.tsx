import type * as React from "react";
import { ChatsShell } from "@/components/chat/chats-shell";

export default function ChatsLayout({ children }: { children: React.ReactNode }) {
  return <ChatsShell>{children}</ChatsShell>;
}
