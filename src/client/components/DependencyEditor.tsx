import { useEffect, useState } from "react";
import { format, addDays, nextSaturday } from "date-fns";
import type { Task, TaskRef } from "../../shared/types";
import { api } from "../lib/api";
import { useTaskInvalidate } from "../lib/queries";
import { BlockedIcon, AddIcon, CloseIcon, CheckIcon } from "../lib/icons";
import { cn, todayStr } from "@/lib/utils";
import { dueLabel } from "../lib/due";

// Why a task cannot be done yet: ONE question, three kinds of answer.
//
// Her words: "whats the difference between having a blocked by, a blocked until
// and a waiting on all there? could we combine them somehow, to have it more
// clean?" She is right about the question and the controls, and wrong about the
// data, so this combines exactly one of the two.
//
// From her side it IS one decision, asked once: what is this waiting on? Three
// dashed chips in a row made it look like three unrelated features, and made you
// choose the storage before you had finished having the thought.
//
// Underneath they stay three fields, because they do genuinely different work
// downstream and merging them would cost that work:
//   • another TASK   feeds the Flow map and the "unlocks N" chip, and is what
//                    the auto-plan-on-unblock rule watches (worker/lib/unblock).
//   • a DATE         suppresses the task until then. Nothing to chase.
//   • a PERSON/event turns into a CHASE nudge once its expected date passes,
//                    because by then the useful action is chasing, not waiting.
//
// So: one control, three kinds. Empty is a single chip. Set renders only the
// kinds that hold something, because a value you cannot see is worse than a
// field you did not want.

// The shared shell. `open` is now driven from OUTSIDE by the one control above:
// picking a kind opens that editor, and an editor that holds a value is always
// open. It keeps its own state too, so an editor opened by hand stays open.
function Collapsible({
  filled,
  forceOpen,
  children,
}: {
  filled: boolean;
  forceOpen: boolean;
  children: React.ReactNode;
}) {
  if (!filled && !forceOpen) return null;
  return <div className="w-full">{children}</div>;
}

// The one control. Empty, it is a single dashed chip; clicking it asks which
// kind, in her words rather than the schema's ("another task", "a date",
// "someone else"). Whatever she picks opens that editor in place.
export function BlockedEditor({ task }: { task: Task }) {
  const [picking, setPicking] = useState(false);
  const [opened, setOpened] = useState<Kind[]>([]);

  const has = {
    task: (task.depends_on ?? []).length > 0,
    date: !!task.blocked_until,
    person: !!task.waiting_on,
  };
  const anything = has.task || has.date || has.person || opened.length > 0;

  const KINDS: { kind: Kind; label: string; hint: string }[] = [
    { kind: "task", label: "Another task", hint: "It has to happen first" },
    { kind: "date", label: "A date", hint: "Cannot start before then" },
    { kind: "person", label: "Someone else", hint: "Waiting on them to come back" },
  ];

  function pick(kind: Kind) {
    setOpened((o) => (o.includes(kind) ? o : [...o, kind]));
    setPicking(false);
  }

  return (
    <div className="w-full">
      {anything && (
        <div className="space-y-2">
          <BlockersEditor task={task} forceOpen={opened.includes("task")} />
          <BlockedUntilEditor task={task} forceOpen={opened.includes("date")} />
          <WaitingOnEditor task={task} forceOpen={opened.includes("person")} />
        </div>
      )}

      {picking ? (
        <div className="mt-2 w-full overflow-hidden rounded-md border border-border bg-surface">
          <div className="border-b border-border px-2.5 py-1.5 text-[11px] text-subtle">
            What is it waiting on?
          </div>
          {KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              onClick={() => pick(k.kind)}
              className="block w-full px-2.5 py-2 text-left transition-colors hover:bg-surface-2"
            >
              <span className="block text-sm text-foreground">{k.label}</span>
              <span className="block text-[11px] text-subtle">{k.hint}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPicking(false)}
            className="block w-full border-t border-border px-2.5 py-1.5 text-left text-[11px] text-muted transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-dashed border-input px-2.5 py-1 text-[11.5px] text-subtle transition-colors hover:border-primary/50 hover:text-foreground",
            anything && "mt-2"
          )}
        >
          <AddIcon className="h-3 w-3" />
          {anything ? "Add another" : "Blocked"}
        </button>
      )}
    </div>
  );
}

type Kind = "task" | "date" | "person";

// Blocked BY another task: search and pick. The one with a real rate (8%).
export function BlockersEditor({
  task,
  forceOpen = false,
}: {
  task: Task;
  forceOpen?: boolean;
}) {
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
    <Collapsible filled={deps.length > 0} forceOpen={forceOpen}>
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
                "min-w-0 flex-1 truncate",
                d.status === "done" ? "text-subtle line-through" : "text-foreground"
              )}
            >
              {d.title}
            </span>
            {/* The blocker's OWN deadline, here rather than one click away.
                Her words: "I always have to open the blocked tasks, read them,
                see when they are due". */}
            {d.status !== "done" && d.due_date && (
              <span
                className="shrink-0 text-[11px] text-warning"
                title={`This blocker is due ${d.due_date}`}
              >
                due {dueLabel(d.due_date, todayStr())}
              </span>
            )}
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
export function BlockedUntilEditor({
  task,
  forceOpen = false,
}: {
  task: Task;
  forceOpen?: boolean;
}) {
  const invalidate = useTaskInvalidate();
  const [blockedUntil, setBlockedUntil] = useState(task.blocked_until ?? "");
  useEffect(() => setBlockedUntil(task.blocked_until ?? ""), [task]);

  async function setBlock(date: string | null) {
    setBlockedUntil(date ?? "");
    await api.updateTask(task.id, { blocked_until: date });
    invalidate();
  }

  return (
    <Collapsible filled={!!blockedUntil} forceOpen={forceOpen}>
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
export function WaitingOnEditor({
  task,
  forceOpen = false,
}: {
  task: Task;
  forceOpen?: boolean;
}) {
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
    <Collapsible filled={!!task.waiting_on} forceOpen={forceOpen}>
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
