/* KJ Chat service worker.
 *
 * Deliberately small:
 *  - pre-caches an offline fallback page and the app icons;
 *  - never caches API responses, Supabase/LiveKit traffic or authenticated HTML;
 *  - shows web push notifications and routes notification clicks to the right chat.
 */
const CACHE = "kj-chat-v1";
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/badge-96.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  // Network first for pages; fall back to the offline page when the network is unavailable.
  event.respondWith(
    fetch(request).catch(async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match(OFFLINE_URL)) || Response.error();
    }),
  );
});

async function hasFocusedClient() {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return windows.some((client) => client.focused && client.visibilityState === "visible");
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "KJ Chat", body: event.data ? event.data.text() : "" };
  }

  event.waitUntil(
    (async () => {
      // The open app already shows its own in-app alert for messages.
      if (payload.type === "message" && (await hasFocusedClient())) return;
      await self.registration.showNotification(payload.title || "KJ Chat", {
        body: payload.body || "",
        tag: payload.tag,
        renotify: payload.type === "call",
        requireInteraction: payload.type === "call",
        icon: "/icons/icon-192.png",
        badge: "/icons/badge-96.png",
        data: { url: payload.url || "/chats" },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/chats", self.location.origin);
  // Only ever navigate within this app.
  const url = target.origin === self.location.origin ? target.href : `${self.location.origin}/chats`;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
