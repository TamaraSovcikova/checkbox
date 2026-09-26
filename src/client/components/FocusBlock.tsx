// Today's Focus (#3): the numbered shortlist at the top of Today.
//
// Priority says how much a task matters; this says what order the day goes in,
// and which one is being done now. It belongs to the day (see migration 0039),
// so tomorrow starts empty and offers yesterday's leftovers in one tap.

import { useState } from "react";
import type { Task } from "../../shared/types";
import { FOCUS_SOFT_CAP, moveFocus, toggleFocus } from "../../shared/focus";
import { useFocus, useCompleteTask } from "../lib/queries";
import { useTaskUI } from "../lib/ui-context";
import { useCompleteGuard } from "../lib/use-complete-guard";
import { useToast } from "../lib/toast";
import { FocusIcon, CloseIcon, CheckIcon } from "../lib/icons";
import { cn } from "@/lib/utils";

export function FocusBlock() {
  const { tasks, ids, carryover, setFocus } = useFocus();
  const { open } = useTaskUI();
  const complete = useCompleteTask();
  const { guard, dialog } = useCompleteGuard();
  const { toast } = useToast();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [carryDismissed, setCarryDismissed] = useState(false);

  function finish(t: Task, index: number) {
    guard(t, () => {
      complete.mutate({ id: t.id, done: true });
      const next = tasks[index + 1];
      // Finishing the Now task hands the day to the next one; say which.
      if (index === 0 && next) toast(`Done. Next: ${next.title}`);
    });
  }

  if (tasks.length === 0) {
    if (carryover.length > 0 && !carryDismissed) {
      return (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm">
          <FocusIcon className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 text-muted">
            {carryover.length} unfinished from your last focus:{" "}
            <span className="text-foreground">{carryover.map((t) => t.title).join(", ")}</span>
          </span>
          <button
            type="button"
            onClick={() => setFocus(carryover.map((t) => t.id))}
            className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-[var(--primary-foreground)] hover:opacity-90"
          >
            Carry over
          </button>
          <button
            type="button"
            onClick={() => setCarryDismissed(true)}
            className="rounded-md px-2 py-1 text-xs text-subtle hover:text-foreground"
          >
            Start fresh
          </button>
        </div>
      );
    }
    return (
      <p className="mb-3 flex items-center gap-1.5 text-xs text-subtle">
        <FocusIcon className="h-3.5 w-3.5" />
        No focus set. Press <kbd className="rounded border border-border px-1">f</kbd> on a task,
        or use the target icon on a row, to line up what to do first.
      </p>
    );
  }

  return (
    <section aria-label="Focus" className="mb-5 rounded-xl border border-primary/25 bg-primary/5 p-2">
      <header className="mb-1 flex items-center gap-2 px-1.5 pt-0.5">
        <FocusIcon className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Focus</h2>
        <span className="text-xs text-subtle">in order, first is now</span>
        {tasks.length > FOCUS_SOFT_CAP && (
          <span className="ml-auto text-[11px] text-subtle">
            {tasks.length} is a lot for one day
          </span>
        )}
      </header>
      <ol className="space-y-0.5">
        {tasks.map((t, i) => (
          <li
            key={t.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", t.id);
              setDragId(t.id);
            }}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              setOverIndex(e.clientY < r.top + r.height / 2 ? i : i + 1);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId && overIndex !== null) {
                const from = ids.indexOf(dragId);
                setFocus(moveFocus(ids, dragId, overIndex > from ? overIndex - 1 : overIndex));
              }
              setDragId(null);
              setOverIndex(null);
            }}
            onDragEnd={() => {
              setDragId(null);
              setOverIndex(null);
            }}
            className={cn(
              "group flex cursor-grab items-center gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-surface/70 active:cursor-grabbing",
              i === 0 && "bg-surface shadow-sm",
              dragId === t.id && "opacity-40",
              overIndex === i && dragId !== t.id && "shadow-[inset_0_2px_0_var(--primary)]",
              overIndex === i + 1 && i === tasks.length - 1 && "shadow-[inset_0_-2px_0_var(--primary)]"
            )}
          >
            <span
              className={cn(
                "grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1 text-[11px] font-semibold tabular-nums",
                i === 0 ? "bg-primary text-[var(--primary-foreground)]" : "bg-surface-2 text-muted"
              )}
            >
              {i + 1}
            </span>
            <button
              type="button"
              aria-label={`Complete ${t.title}`}
              onClick={() => finish(t, i)}
              className="grid h-4 w-4 shrink-0 place-items-center rounded-full border-[1.5px] border-subtle/70 text-transparent transition-colors hover:border-primary hover:text-primary"
            >
              <CheckIcon className="h-2.5 w-2.5" strokeWidth={3} />
            </button>
            <button
              type="button"
              onClick={() => open(t)}
              className={cn(
                "min-w-0 flex-1 truncate text-left text-sm",
                i === 0 ? "font-medium text-foreground" : "text-foreground/90"
              )}
            >
              {t.title}
            </button>
            {i === 0 && (
              <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                Now
              </span>
            )}
            <button
              type="button"
              aria-label={`Take ${t.title} out of focus`}
              title="Take out of focus (stays in Today)"
              onClick={() => setFocus(toggleFocus(ids, t.id))}
              className="hidden h-5 w-5 shrink-0 place-items-center rounded text-subtle hover:text-foreground group-hover:grid max-md:grid"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ol>
      {dialog}
    </section>
  );
}

// The row-level switch: in the same spot and style as the Today toggle.
export function FocusToggle({ task, className }: { task: Task; className?: string }) {
  const { ids, isFocused, rank, setFocus } = useFocus();
  const on = isFocused(task.id);
  return (
    <button
      aria-label={on ? "Take out of focus" : "Add to focus"}
      title={on ? `Focus #${rank(task.id)}: click to take out` : "Add to today's focus"}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        setFocus(toggleFocus(ids, task.id), [task]);
      }}
      className={cn(
        "relative z-10 h-5 shrink-0 place-items-center rounded transition-colors before:absolute before:-inset-1.5 before:content-['']",
        on
          ? "grid min-w-5 px-0.5 text-[10px] font-semibold text-primary"
          : "hidden w-5 text-subtle hover:text-foreground group-hover:grid",
        className
      )}
    >
      {on ? (
        <span className="inline-flex items-center gap-0.5">
          <FocusIcon className="h-3 w-3" />
          {rank(task.id)}
        </span>
      ) : (
        <FocusIcon className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
