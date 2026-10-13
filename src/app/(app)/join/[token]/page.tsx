import type { Metadata } from "next";
import { JoinGroup } from "./join-group";

export const metadata: Metadata = { title: "Join group" };

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <JoinGroup token={token.slice(0, 128)} />;
}
