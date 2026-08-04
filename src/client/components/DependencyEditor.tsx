import { useEffect, useState } from "react";
import { format, addDays, nextSaturday } from "date-fns";
import type { Task, TaskRef } from "../../shared/types";
import { api } from "../lib/api";
import { useTaskInvalidate } from "../lib/queries";
import { BlockedIcon, AddIcon, CloseIcon, CheckIcon } from "../lib/icons";
import { cn } from "@/lib/utils";

// The three ways a task can be waiting, each its own control: blocked BY another
// task, blocked UNTIL a date, waiting on the WORLD. The row/view badge derives
// from all three.
//
// Each is empty on the overwhelming majority of tasks (8%, 1%, 1%), and each
// used to render its full editor regardless: a heading, a list, an add button, a
// date input with two presets, two text fields. That is most of a screen spent
// saying "no" on a task that has nothing to say. Empty now means ONE dashed
// chip; clicking it opens the real control in place. Set means the control, in
// full, because a value you cannot see is worse than a field you did not want.

// The shared shell: chip when there is nothing to show, editor once there is.
function Collapsible({
  label,
  filled,
  children,
}: {
  label: string;
  filled: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!filled && !open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-input px-2.5 py-1 text-[11.5px] text-subtle transition-colors hover:border-primary/50 hover:text-foreground"
      >
        <AddIcon className="h-3 w-3" />
        {label}
      </button>
    );
  return <div className="w-full">{children}</div>;
}

// Blocked BY another task: search and pick. The one with a real rate (8%).
export function BlockersEditor({ task }: { task: Task }) {
  const invalidate = useTaskInvalidate();
  const [deps, setDeps] = useState<TaskRef[]>(task.depends_on ?? []);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Task[]>([]);

  useEffect(() => setDeps(task.depends_on ?? []), [task]);

  useEffect(() => {
    if (!adding || q.trim().length < 2) {
      setResults([]);
      return;
    }
    let live = true;
    api.searchTasks(q.trim()).then((r) => {
      if (live)
        setResults(
          r.filter((t) => t.id !== task.id && !deps.some((d) => d.id === t.id))
        );
    });
    return () => {
      live = false;
    };
  }, [q, adding, task.id, deps]);

  async function add(t: Task) {
    setDeps((d) => [...d, { id: t.id, title: t.title, status: t.status }]);
    setQ("");
    setAdding(false);
    setResults([]);
    await api.addDependency(task.id, t.id);
    invalidate();
  }

  async function remove(id: string) {
    setDeps((d) => d.filter((x) => x.id !== id));
    await api.removeDependency(task.id, id);
    invalidate();
  }

  const openBlockers = deps.filter((d) => d.status !== "done").length;

  return (
    <Collapsible label="Blocker" filled={deps.length > 0}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <BlockedIcon className="h-3.5 w-3.5" /> Blocked by
        </span>
        {openBlockers > 0 && (
          <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
            {openBlockers} open
          </span>
        )}
      </div>

      <div className="mt-2 space-y-1">
        {deps.map((d) => (
          <div
            key={d.id}
            className="group flex items-center gap-2 rounded-md bg-surface px-2 py-1.5 text-sm"
          >
            <span
              className={cn(
                "grid h-4 w-4 shrink-0 place-items-center rounded-full border",
                d.status === "done"
                  ? "border-success bg-success/20 text-success"
                  : "border-warning"
              )}
            >
              {d.status === "done" && <CheckIcon className="h-2.5 w-2.5" />}
            </span>
            <span
              className={cn(
                "flex-1 truncate",
                d.status === "done" ? "text-subtle line-through" : "text-foreground"
              )}
            >
              {d.title}
            </span>
            <button
              onClick={() => remove(d.id)}
              aria-label="Remove blocker"
              className="hidden shrink-0 text-subtle hover:text-danger group-hover:block"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {adding ? (
        <div className="mt-1.5">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a task to wait on…"
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
          <AddIcon className="h-3.5 w-3.5" /> Add blocker
        </button>
      )}
    </Collapsible>
  );
}

// Blocked until a DATE ("wait until next Saturday"). Independent of blockers;
// either one keeps the task blocked.
export function BlockedUntilEditor({ task }: { task: Task }) {
  const invalidate = useTaskInvalidate();
  const [blockedUntil, setBlockedUntil] = useState(task.blocked_until ?? "");
  useEffect(() => setBlockedUntil(task.blocked_until ?? ""), [task]);

  async function setBlock(date: string | null) {
    setBlockedUntil(date ?? "");
    await api.updateTask(task.id, { blocked_until: date });
    invalidate();
  }

  return (
    <Collapsible label="Blocked until" filled={!!blockedUntil}>
      <span className="flex items-center gap-1.5 text-xs text-muted">
        <BlockedIcon className="h-3.5 w-3.5" /> Blocked until
        {blockedUntil && <span className="text-warning">{blockedUntil}</span>}
      </span>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <input
          type="date"
          value={blockedUntil}
          onChange={(e) => setBlock(e.target.value || null)}
          className="h-8 rounded-md border border-input bg-surface px-2 text-sm text-foreground outline-none focus:border-primary"
        />
        <button
          onClick={() => setBlock(format(nextSaturday(new Date()), "yyyy-MM-dd"))}
          className="rounded-md bg-surface-2 px-2 py-1 text-xs text-foreground transition-colors hover:bg-surface-2/70"
        >
          Next Saturday
        </button>
        <button
          onClick={() => setBlock(format(addDays(new Date(), 7), "yyyy-MM-dd"))}
          className="rounded-md bg-surface-2 px-2 py-1 text-xs text-foreground transition-colors hover:bg-surface-2/70"
        >
          In a week
        </button>
        {blockedUntil && (
          <button
            onClick={() => setBlock(null)}
            className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>
    </Collapsible>
  );
}

// Waiting on an EXTERNAL event ("Revolut card arrives"): not a block, the task
// stays visible with a chip; once the expected date passes the chip flips to
// "chase". Blockers wait on tasks, this waits on the world.
export function WaitingOnEditor({ task }: { task: Task }) {
  const invalidate = useTaskInvalidate();
  const [waitingOn, setWaitingOn] = useState(task.waiting_on ?? "");
  const [waitingExpected, setWaitingExpected] = useState(task.waiting_expected ?? "");

  useEffect(() => setWaitingOn(task.waiting_on ?? ""), [task]);
  useEffect(() => setWaitingExpected(task.waiting_expected ?? ""), [task]);

  async function saveWaiting(on: string, expected: string) {
    await api.updateTask(task.id, {
      waiting_on: on.trim() || null,
      waiting_expected: on.trim() ? expected || null : null,
    });
    invalidate();
  }

  return (
    <Collapsible label="Waiting on" filled={!!task.waiting_on}>
      <span className="flex items-center gap-1.5 text-xs text-muted">
        <BlockedIcon className="h-3.5 w-3.5" /> Waiting on
        {task.waiting_expected && task.waiting_on && (
          <span className="text-warning">by {task.waiting_expected}</span>
        )}
      </span>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <input
          value={waitingOn}
          onChange={(e) => setWaitingOn(e.target.value)}
          onBlur={() => saveWaiting(waitingOn, waitingExpected)}
          placeholder="e.g. Revolut card arrives"
          autoFocus={!task.waiting_on}
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-surface px-2 text-sm text-foreground outline-none placeholder:text-subtle focus:border-primary"
        />
        <input
          type="date"
          value={waitingExpected}
          onChange={(e) => {
            setWaitingExpected(e.target.value);
            if (waitingOn.trim()) saveWaiting(waitingOn, e.target.value);
          }}
          title="Expected by"
          className="h-8 rounded-md border border-input bg-surface px-2 text-sm text-foreground outline-none focus:border-primary"
        />
        {(waitingOn || waitingExpected) && (
          <button
            onClick={() => {
              setWaitingOn("");
              setWaitingExpected("");
              saveWaiting("", "");
            }}
            className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>
    </Collapsible>
  );
}
