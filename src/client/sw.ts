/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// ── Push notification handler ──────────────────────────────────────────────────
// Service worker wakes on a data-less push, fetches brief-data, shows notification.

self.addEventListener("push", (event) => {
  const show = fetch("/api/push/brief-data")
    .then((r) => r.json() as Promise<{ total: number; urgent: number; overdue: number; date: string }>)
    .then((data) => {
      const body =
        data.total > 0
          ? `${data.total} task${data.total !== 1 ? "s" : ""} today${
              data.overdue ? ` · ${data.overdue} overdue` : ""
            }${data.urgent ? ` · ${data.urgent} urgent` : ""}`
          : "Nothing due today — enjoy! 🎉";

      return self.registration.showNotification(`Checkbox · ${data.date}`, {
        body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: "morning-brief",
      });
    })
    .catch(() =>
      self.registration.showNotification("Checkbox", {
        body: "Morning brief ready",
        tag: "morning-brief",
      })
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
