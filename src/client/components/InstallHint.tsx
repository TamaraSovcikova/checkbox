import { useEffect, useState } from "react";
import { CloseIcon, LogoIcon } from "../lib/icons";
import { Button } from "./ui";

const KEY = "cb_install_dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari exposes navigator.standalone when launched from the home screen
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS() {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !(window as unknown as { MSStream?: unknown }).MSStream
  );
}

// Install affordance. Already-installed users see nothing. Android gets a real
// "Install" button wired to the captured beforeinstallprompt; iOS (which never
// fires an install prompt) gets Add-to-Home-Screen instructions. `dismissible`
// controls the ✕ + localStorage memory (banner on Today) vs an always-on section
// (Settings).
export function InstallHint({ dismissible = true }: { dismissible?: boolean }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone());
  const [dismissed, setDismissed] = useState(
    () => dismissible && localStorage.getItem(KEY) === "1"
  );

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || dismissed) return null;
  const ios = isIOS();
  // Nothing actionable to show: not iOS and no install prompt available (e.g.
  // desktop that already meets criteria will fire the event; if it never fires
  // and we're not iOS, hide rather than show a dead hint).
  if (!ios && !deferred) return null;

  function close() {
    if (dismissible) localStorage.setItem(KEY, "1");
    setDismissed(true);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  }

  return (
    <div className="relative mb-5 max-w-2xl rounded-xl border border-primary/40 bg-primary/5 p-4">
      {dismissible && (
        <button
          onClick={close}
          aria-label="Dismiss"
          className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded text-subtle hover:bg-surface-2 hover:text-foreground"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      )}
      <div className="flex items-start gap-3">
        <LogoIcon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Install Checkbox</p>
          {ios ? (
            <p className="mt-1 text-xs text-muted">
              In Safari, tap the Share button{" "}
              <span aria-hidden>⎋</span> then{" "}
              <span className="text-foreground">Add to Home Screen</span> to install
              it as an app (and get push notifications).
            </p>
          ) : (
            <div className="mt-2">
              <Button variant="primary" className="h-8 text-xs" onClick={install}>
                Install app
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
