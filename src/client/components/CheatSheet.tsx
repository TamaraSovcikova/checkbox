import { useState } from "react";
import { CloseIcon } from "../lib/icons";

const KEY = "cb_cheatsheet_dismissed";

const ROWS: { syntax: string; means: string }[] = [
  { syntax: "tomorrow 3pm", means: "due date + time" },
  { syntax: "next tue", means: "natural-language dates" },
  { syntax: "every monday", means: "recurring task" },
  { syntax: "p1", means: "priority (p1 urgent … p4)" },
  { syntax: "@errand", means: "label" },
  { syntax: "#Project", means: "drop into a project" },
];

// Dismissible cheat-sheet for the capture syntax. Shown until the user closes it
// (persisted in localStorage). The capture placeholder still teaches inline; this
// is the first-run legend (#20).
export function CheatSheet() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(KEY) === "1"
  );
  if (dismissed) return null;

  function close() {
    localStorage.setItem(KEY, "1");
    setDismissed(true);
  }

  return (
    <div className="relative mb-5 max-w-2xl rounded-xl border border-border bg-surface/40 p-4">
      <button
        onClick={close}
        aria-label="Dismiss"
        className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded text-subtle hover:bg-surface-2 hover:text-foreground"
      >
        <CloseIcon className="h-4 w-4" />
      </button>
      <p className="mb-3 text-sm font-medium text-foreground">
        Capture faster: type it all in one line
      </p>
      <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {ROWS.map((r) => (
          <div key={r.syntax} className="flex items-baseline gap-2 text-sm">
            <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[12px] text-primary">
              {r.syntax}
            </code>
            <span className="text-xs text-subtle">{r.means}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
