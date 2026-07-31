// Keeping an open tab on the deployed build.
//
// The PWA precaches index.html, so an open tab (or a reload timed before the
// new service worker finishes installing) keeps running the OLD bundle even
// though the server is serving a new one: index.html comes from Cache Storage,
// which the HTTP cache headers cannot help with. Deploys took two reloads and
// once needed a manual registration.update() to land.
//
// Ground truth here is deliberately NOT a version constant that has to be
// threaded through the build: it is what a fresh visitor would actually get.
// The server reports the entry script of the deployed index.html and this tab
// compares it with the one it is running. Different hash = a deploy happened.
//
// The question goes to /api/version rather than "/" because the service worker
// routes /api/* NetworkOnly: asking for "/" would be answered BY the precache,
// so a stale tab would compare its stale build against itself and never notice
// anything. That mistake was caught live, not in review.

const ASSET_RE = /assets\/index-[A-Za-z0-9_-]+\.js/;

// The entry bundle this tab loaded, e.g. "assets/index-BAbICW3B.js".
export function runningBundle(): string | null {
  for (const el of document.querySelectorAll<HTMLScriptElement>("script[src]")) {
    const m = el.getAttribute("src")?.match(ASSET_RE);
    if (m) return m[0];
  }
  return null;
}

// What the server would serve right now. Null when the check itself failed
// (offline, an old server without the endpoint, a stray error page): unknown is
// never treated as stale, because a false positive reloads her page.
export async function deployedBundle(): Promise<string | null> {
  try {
    const res = await fetch(`/api/version?_v=${Date.now()}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { bundle?: unknown };
    return typeof data.bundle === "string" && ASSET_RE.test(data.bundle)
      ? data.bundle
      : null;
  } catch {
    return null;
  }
}

export async function isStale(): Promise<string | null> {
  const mine = runningBundle();
  if (!mine) return null; // dev server: no hashed bundle to compare
  const theirs = await deployedBundle();
  return theirs && theirs !== mine ? theirs : null;
}

// Reload onto the new build. Ask the service worker to pick up the new
// precache first, so the reload is served the new index.html rather than
// racing the install and needing a second one.
export async function applyUpdate(target: string): Promise<void> {
  const attempted = sessionStorage.getItem(RELOAD_KEY);
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch {
    /* a failed update must never block the reload below */
  }
  // Escape hatch: if we already reloaded for THIS bundle and are still on the
  // old one, the precache is wedged. Drop it and the worker, then reload
  // un-serviced, which always lands on the deployed build.
  if (attempted === target) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.unregister();
    } catch {
      /* best effort */
    }
  }
  sessionStorage.setItem(RELOAD_KEY, target);
  window.location.reload();
}

const RELOAD_KEY = "checkbox:update-reload-for";

// True when this tab has already reloaded once trying to reach `target`, so
// the caller offers a manual button instead of looping.
export const alreadyTried = (target: string) =>
  sessionStorage.getItem(RELOAD_KEY) === target;
