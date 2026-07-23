import { useState, type ReactNode } from "react";
import { InfoIcon, CloseIcon } from "../lib/icons";

// A page explainer that retires itself. The paragraph is written for first
// contact; after that it is furniture you scan past, so once dismissed it
// collapses to an (i) button that toggles it back on demand. Dismissal is
// remembered per page key, per browser.
export function PageIntro({ id, children }: { id: string; children: ReactNode }) {
  const key = `cb-intro-${id}`;
  const [open, setOpen] = useState(() => localStorage.getItem(key) !== "dismissed");
  const dismissed = localStorage.getItem(key) === "dismissed";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="What is this page?"
        aria-label="What is this page?"
        className="mb-4 inline-flex items-center gap-1 text-xs text-subtle transition-colors hover:text-foreground"
      >
        <InfoIcon className="h-3.5 w-3.5" />
        About this page
      </button>
    );
  }

  return (
    <div className="mb-4 flex items-start gap-2">
      <p className="min-w-0 flex-1 text-sm text-subtle">{children}</p>
      <button
        type="button"
        onClick={() => {
          localStorage.setItem(key, "dismissed");
          setOpen(false);
        }}
        title={dismissed ? "Collapse" : "Got it, collapse this"}
        aria-label="Dismiss explainer"
        className="mt-0.5 shrink-0 rounded p-0.5 text-subtle transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
