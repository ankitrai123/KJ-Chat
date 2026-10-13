import { redirect } from "next/navigation";

// The proxy already routes "/" to /chats or /login; this is a fallback.
export default function Home() {
  redirect("/chats");
}
