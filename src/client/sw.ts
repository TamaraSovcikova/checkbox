/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkOnly } from "workbox-strategies";

declare const self: ServiceWorkerGlobalScope;

// Activate a new service worker (and take control of open tabs) immediately
// instead of waiting for all tabs to close. Without this, a fix shipped here
// only reaches users after they fully quit and reopen the browser tab.
self.skipWaiting();
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

cleanupOutdatedCaches();

// Workbox's precache route treats any same-origin, extensionless navigation
// as an SPA route and serves the cached index.html for it by default
// (`cleanURLs`). That silently hijacks real server routes like
// /api/auth/google: the browser never leaves the app shell, so the Google
// OAuth redirect (and any other /api/* or /mcp navigation) never happens.
// Registering this NetworkOnly route before precacheAndRoute() gives it
// priority (workbox-routing matches in registration order), so these paths
// always hit the network and let the Worker's real redirect/response through.
registerRoute(
  ({ url }) => url.pathname.startsWith("/api/") || url.pathname.startsWith("/mcp"),
  new NetworkOnly()
);

precacheAndRoute(self.__WB_MANIFEST);

// ── Push notification handler ──────────────────────────────────────────────────
// Push is data-less, so the SW asks the server what this wake-up was about:
// /notify-data answers "reminder" (a due-time just passed) or "brief". Falls
// back to the brief shape so a push never shows nothing.

self.addEventListener("push", (event) => {
  const showBrief = () =>
    fetch("/api/push/brief-data")
      .then((r) => r.json() as Promise<{ total: number; urgent: number; overdue: number; date: string }>)
      .then((data) => {
        const body =
          data.total > 0
            ? `${data.total} task${data.total !== 1 ? "s" : ""} today${
                data.overdue ? ` · ${data.overdue} overdue` : ""
              }${data.urgent ? ` · ${data.urgent} urgent` : ""}`
            : "Nothing due today. Enjoy! 🎉";

        return self.registration.showNotification(`Checkbox · ${data.date}`, {
          body,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: "morning-brief",
        });
      });

  const show = fetch("/api/push/notify-data")
    .then((r) => r.json() as Promise<{ kind: string; title?: string; body?: string }>)
    .then((data) => {
      if (data.kind === "reminder" && data.body) {
        return self.registration.showNotification(data.title || "Due now", {
          body: data.body,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: "due-reminder",
        });
      }
      return showBrief();
    })
    .catch(() =>
      showBrief().catch(() =>
        self.registration.showNotification("Checkbox", {
          body: "You have an update",
          tag: "morning-brief",
        })
      )
    );

  event.waitUntil(show);
});

// ── Notification click ─────────────────────────────────────────────────────────

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((c) => c.url.includes(self.location.origin));
        if (existing) return existing.focus();
        return self.clients.openWindow("/");
      })
  );
});
