import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KJ Chat",
    short_name: "KJ Chat",
    description: "Private messaging, groups and calls for a small circle of trusted people.",
    start_url: "/chats",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#12181f",
    theme_color: "#1b8a8a",
    categories: ["social", "communication"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
