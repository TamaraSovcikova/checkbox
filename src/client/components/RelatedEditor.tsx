import { useEffect, useState } from "react";
import type { Task, TaskRef } from "../../shared/types";
import { api } from "../lib/api";
import { useTaskInvalidate } from "../lib/queries";
import { useTaskUI } from "../lib/ui-context";
import { LinkIcon, AddIcon, CloseIcon } from "../lib/icons";
import { cn } from "@/lib/utils";

// A task's related tasks: things that belong together without waiting on each
// other. Deliberately a separate control from DependencyEditor above it, because
// the two answer different questions: "what has to happen first" (blocking, and
// it drives the Flow runway) versus "what else is part of this" (nothing but
// context). Folding them into one list would make every link look like an order.
//
// Links are symmetric, so removing from either side removes the pair, and a
// linked task's chip opens that task in this same sheet.
export function RelatedEditor({ task }: { task: Task }) {
  const invalidate = useTaskInvalidate();
  const { open } = useTaskUI();
  const [links, setLinks] = useState<TaskRef[]>(task.related ?? []);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Task[]>([]);

  useEffect(() => setLinks(task.related ?? []), [task]);

  useEffect(() => {
    if (!adding || q.trim().length < 2) {
      setResults([]);
      return;
    }
    let live = true;
    api.searchTasks(q.trim()).then((r) => {
      if (live)
        setResults(
          r.filter((t) => t.id !== task.id && !links.some((l) => l.id === t.id))
        );
    });
    return () => {
      live = false;
    };
  }, [q, adding, task.id, links]);

  async function add(t: Task) {
    setLinks((l) => [...l, { id: t.id, title: t.title, status: t.status }]);
    setQ("");
    setAdding(false);
    setResults([]);
    await api.linkTask(task.id, t.id);
    invalidate();
  }

  async function remove(id: string) {
    setLinks((l) => l.filter((x) => x.id !== id));
    await api.unlinkTask(task.id, id);
    invalidate();
  }

  // Jump to the other side of a link. The chip only carries id/title/status, so
  // fetch the full task before handing it to the sheet.
  async function jump(id: string) {
    open(await api.getTask(id));
  }

  // Nothing linked and nothing being typed: one dashed chip, like the blocker
  // and waiting-on controls it sits beside. A heading over an empty list is the
  // sheet telling you about a feature rather than about this task.
  if (links.length === 0 && !adding)
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-input px-2.5 py-1 text-[11.5px] text-subtle transition-colors hover:border-primary/50 hover:text-foreground"
      >
        <AddIcon className="h-3 w-3" />
        Link
      </button>
    );

  return (
    <div className="w-full">
      <span className="flex items-center gap-1.5 text-xs text-muted">
        <LinkIcon className="h-3.5 w-3.5" /> Related
      </span>

      {links.length > 0 && (
        <div className="mt-2 space-y-1">
          {links.map((l) => (
            <div
              key={l.id}
              className="group flex items-center gap-2 rounded-md bg-surface px-2 py-1.5 text-sm"
            >
              <LinkIcon className="h-3.5 w-3.5 shrink-0 text-subtle" />
              <button
                onClick={() => jump(l.id)}
                title="Open this task"
                className={cn(
                  "flex-1 truncate text-left hover:text-primary",
                  l.status === "done" ? "text-subtle line-through" : "text-foreground"
                )}
              >
                {l.title}
              </button>
              <button
                onClick={() => remove(l.id)}
                aria-label="Remove link"
                className="hidden shrink-0 text-subtle hover:text-danger group-hover:block"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <div className="mt-1.5">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a task to link…"
            autoFocus
            onBlur={() => !q && setAdding(false)}
            className="h-8 w-full rounded-md border border-input bg-surface px-2 text-sm text-foreground outline-none focus:border-primary"
          />
          {results.length > 0 && (
            <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-surface">
              {results.map((t) => (
                <button
                  key={t.id}
                  onClick={() => add(t)}
                  className="block w-full truncate px-2 py-1.5 text-left text-sm text-foreground hover:bg-surface-2"
                >
                  {t.title}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="mt-1.5 flex items-center gap-1 text-xs text-primary hover:text-primary-hover"
        >
          <AddIcon className="h-3.5 w-3.5" /> Link a task
        </button>
      )}
    </div>
  );
}
