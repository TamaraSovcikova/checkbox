// Watches for a deploy and gets this tab onto it.
//
// Checks on mount, whenever the tab comes back to the foreground, when the
// network returns, and every 15 minutes. When a new build exists:
//
//  - if the tab was away a while (>= 45s hidden), reload straight onto it: she
//    is returning to a stale tab and there is nothing in flight to lose;
//  - otherwise show a quiet pill, because silently reloading a page mid-typing
//    is hostile. One click applies it.
//
// The auto-reload runs at most once per detected build (see lib/update's
// reload guard); if it lands still-stale, the pill takes over and its second
// attempt drops the precache entirely.

import { useEffect, useRef, useState } from "react";
import { isStale, applyUpdate, alreadyTried } from "../lib/update";
import { RefreshIcon } from "../lib/icons";

const CHECK_EVERY_MS = 15 * 60 * 1000;
const AWAY_LONG_ENOUGH_MS = 45 * 1000;

export function UpdateGate() {
  const [target, setTarget] = useState<string | null>(null);
  const hiddenSince = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    // `auto` asks for a reload without a click; only the returning-to-a-stale-
    // tab path passes it.
    const check = async (auto: boolean) => {
      const found = await isStale();
      if (cancelled || !found) return;
      setTarget(found);
      if (auto && !alreadyTried(found)) applyUpdate(found);
    };

    check(false);

    const onVisible = () => {
      if (document.visibilityState === "hidden") {
        hiddenSince.current = Date.now();
        return;
      }
      const away = hiddenSince.current ? Date.now() - hiddenSince.current : 0;
      hiddenSince.current = null;
      check(away >= AWAY_LONG_ENOUGH_MS);
    };

    const onOnline = () => check(false);
    const timer = setInterval(() => check(false), CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);

    // A service worker taking control mid-session means the precache just
    // changed under this tab: re-check rather than trusting what is loaded.
    const onController = () => check(false);
    navigator.serviceWorker?.addEventListener("controllerchange", onController);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      navigator.serviceWorker?.removeEventListener("controllerchange", onController);
    };
  }, []);

  if (!target) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
      <button
        type="button"
        onClick={() => applyUpdate(target)}
        className="flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-2 text-xs font-medium text-foreground shadow-lg transition-colors hover:bg-surface-2"
      >
        <RefreshIcon className="h-3.5 w-3.5 text-primary" />
        New version available
        <span className="text-subtle">· reload</span>
      </button>
    </div>
  );
}
