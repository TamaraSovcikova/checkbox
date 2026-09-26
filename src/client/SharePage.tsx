import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { parseCapture } from "./lib/nlp";
import { useCreateTask } from "./lib/queries";
import { useToast } from "./lib/toast";
import { LogoIcon } from "./lib/icons";

// PWA share target (manifest share_target -> GET /share?title&text&url).
// Sharing is capture: the shared content becomes a Backlog task, through the
// same NLP the capture bar uses.
//
// ONE tap to confirm (#10). It used to create the task the moment the page
// loaded, which was the point of a share sheet, but it also meant any link on
// any website pointing at /share?title=... planted a task in the Backlog, where
// agents read it over MCP. Nothing in a GET navigation says whether the phone's
// share sheet or a web page sent it, so the page shows what it will add and
// waits for the tap (Enter works too).
//
// The task title is the shared title or text; a shared url goes into notes so
// a long link never becomes an unreadable title.
export function shareDraft(params: URLSearchParams) {
  const title = (params.get("title") ?? "").trim();
  const text = (params.get("text") ?? "").trim();
  const url = (params.get("url") ?? "").trim();
  // Some apps put the link in `text` rather than `url`.
  const textIsUrl = /^https?:\/\/\S+$/.test(text);
  const captureText = title || (textIsUrl ? "Look at this link" : text) || url;
  if (!captureText) return null;
  const parsed = parseCapture(captureText, []);
  const notes = [textIsUrl ? text : url, !textIsUrl && title && text ? text : null]
    .filter(Boolean)
    .join("\n");
  return {
    title: parsed.title || captureText,
    due_date: parsed.due_date,
    due_time: parsed.due_time,
    priority: parsed.priority ?? 4,
    labelNames: parsed.labelNames,
    notes: notes || null,
  };
}

export function SharePage() {
  const [params] = useSearchParams();
  const create = useCreateTask();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [failed, setFailed] = useState(false);
  const draft = shareDraft(params);
  const leave = () => navigate("/backlog", { replace: true });

  function add() {
    if (!draft || create.isPending) return;
    create.mutate(draft, {
      onSuccess: () => {
        toast("Captured to Backlog");
        leave();
      },
      onError: () => setFailed(true),
    });
  }

  return (
    <div className="grid min-h-[60vh] place-items-center px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
        <LogoIcon className="h-8 w-8 text-primary" />
        {!draft ? (
          <>
            <p className="text-sm text-subtle">Nothing to capture.</p>
            <button onClick={leave} className="text-sm text-primary hover:underline">
              Go to Backlog
            </button>
          </>
        ) : (
          <>
            <p className="text-xs uppercase tracking-wide text-subtle">Add to Backlog</p>
            <div className="w-full rounded-lg border border-border bg-surface p-3 text-left">
              <div className="text-sm font-medium text-foreground">{draft.title}</div>
              {draft.notes && (
                <div className="mt-1 break-all text-xs text-subtle">{draft.notes}</div>
              )}
            </div>
            {failed && (
              <p className="text-sm text-danger">Could not capture that. Are you offline?</p>
            )}
            <div className="flex w-full gap-2">
              <button
                onClick={leave}
                className="flex-1 rounded-md border border-border px-3 py-2 text-sm text-muted hover:text-foreground"
              >
                Cancel
              </button>
              <button
                autoFocus
                onClick={add}
                disabled={create.isPending}
                className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-60"
              >
                {create.isPending ? "Adding…" : "Add to Backlog"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
