import { useState } from "react";
import {
  useNoteCandidates,
  useAcceptNoteCandidate,
  useRejectNoteCandidate,
  useAddNoteCandidates,
} from "../lib/queries";
import { useToast } from "../lib/toast";
import { extractNoteTasks } from "../../shared/notes";
import { api } from "../lib/api";
import { useTaskInvalidate } from "../lib/queries";
import { NotesIcon, CheckIcon, CloseIcon } from "../lib/icons";
import { Button, cx } from "./ui";

const KIND_LABEL: Record<string, string> = {
  checkbox: "checkbox",
  todo: "TODO",
  commitment: "commitment",
};

// "From your notes" inbox on Backlog (roadmap #31). Claude scans the Obsidian
// vault via the scan_notes_for_tasks MCP tool and files candidates here; the user
// accepts them into Backlog (with a source backlink) or rejects them. A manual
// paste box runs the same deterministic extractor client-side for a no-Claude path.
export function NotesInbox() {
  const { data: candidates = [] } = useNoteCandidates();
  const accept = useAcceptNoteCandidate();
  const reject = useRejectNoteCandidate();
  const add = useAddNoteCandidates();
  const invalidate = useTaskInvalidate();
  const { toast } = useToast();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pastePath, setPastePath] = useState("");

  async function acceptAll() {
    const ids = candidates.map((c) => c.id);
    await Promise.all(ids.map((id) => api.acceptNoteCandidate(id)));
    invalidate();
    toast(`Added ${ids.length} task${ids.length !== 1 ? "s" : ""} to Backlog`);
  }

  async function runPaste() {
    const found = extractNoteTasks(pasteText);
    if (!found.length) {
      toast("No `- [ ]` or TODO items found in that text");
      return;
    }
    const res = await add.mutateAsync(
      found.map((f) => ({
        title: f.title,
        source_path: pastePath.trim() || null,
        source_line: f.line,
        kind: f.kind,
        context: f.context,
      }))
    );
    toast(`Found ${found.length}, added ${res.added} new`);
    setPasteText("");
    setPasteOpen(false);
  }

  const hasCandidates = candidates.length > 0;

  return (
    <div className="mb-5 rounded-xl border border-border bg-surface/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <NotesIcon className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">From your notes</span>
          {hasCandidates && (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
              {candidates.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasCandidates && (
            <Button variant="subtle" className="h-7 text-xs" onClick={acceptAll}>
              Accept all
            </Button>
          )}
          <button
            onClick={() => setPasteOpen((o) => !o)}
            className="text-xs text-subtle hover:text-foreground"
          >
            {pasteOpen ? "cancel" : "paste a note"}
          </button>
        </div>
      </div>

      {pasteOpen && (
        <div className="mb-3 space-y-2">
          <input
            value={pastePath}
            onChange={(e) => setPastePath(e.target.value)}
            placeholder="Source path (optional), e.g. Daily/2026-07-07.md"
            className="h-8 w-full rounded-md border border-input bg-surface px-2 text-sm text-foreground outline-none focus:border-primary"
          />
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={"Paste note markdown here…\n- [ ] unchecked boxes and TODO: lines become tasks"}
            rows={4}
            className="w-full resize-none rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
          <Button
            variant="primary"
            className="h-7 text-xs"
            onClick={runPaste}
            disabled={!pasteText.trim() || add.isPending}
          >
            Extract tasks
          </Button>
        </div>
      )}

      {!hasCandidates ? (
        <p className="text-xs text-subtle">
          Ask Claude to scan your Obsidian daily notes. It files{" "}
          <code className="rounded bg-surface-2 px-1 text-[11px]">- [ ]</code> items
          and commitments here via the <code className="rounded bg-surface-2 px-1 text-[11px]">scan_notes_for_tasks</code>{" "}
          MCP tool. Or paste a note above.
        </p>
      ) : (
        <div className="space-y-1.5">
          {candidates.map((c) => (
            <div
              key={c.id}
              className="group flex items-start gap-2 rounded-md bg-surface px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-foreground">{c.title}</span>
                  <span
                    className={cx(
                      "shrink-0 rounded px-1 py-0.5 text-[10px] uppercase tracking-wide",
                      c.kind === "commitment"
                        ? "bg-warning/15 text-warning"
                        : "bg-surface-2 text-subtle"
                    )}
                  >
                    {KIND_LABEL[c.kind] ?? c.kind}
                  </span>
                </div>
                {c.source_path && (
                  <div className="truncate text-[11px] text-subtle">
                    {c.source_path}
                    {c.source_line ? ` · line ${c.source_line}` : ""}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() =>
                    accept.mutate(c.id, {
                      onSuccess: () => toast("Added to Backlog"),
                    })
                  }
                  aria-label="Accept"
                  title="Add to Backlog"
                  className="grid h-7 w-7 place-items-center rounded-md text-success hover:bg-success/10"
                >
                  <CheckIcon className="h-4 w-4" />
                </button>
                <button
                  onClick={() => reject.mutate(c.id)}
                  aria-label="Reject"
                  title="Dismiss"
                  className="grid h-7 w-7 place-items-center rounded-md text-subtle hover:bg-surface-2 hover:text-foreground"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
