import { useMemo, useState } from "react";
import type { Task } from "../../shared/types";
import { stalePlannedTasks, STALE_PLAN_DAYS } from "../lib/today";
import { useUpdateTask } from "../lib/queries";
import { useToast } from "../lib/toast";
import { todayStr } from "@/lib/utils";

// A gentle nudge for tasks that have sat in Today on a stale plan.
//
// Carry-forward keeps an unfinished plan in Today indefinitely (planned_date <=
// today), which is right until it is not: a task you planned three weeks ago and
// never touched is clutter dressed as intent. This asks about exactly those (see
// stalePlannedTasks: old plan, and nothing else keeping it in Today), and only
// when there are some. Never shown otherwise, so it is silent on a tidy day.
//
// Two answers, matching "still want it today?": Clear drops the plan (the task
// falls back to its area/Backlog), Keep re-plans it for today so the counter
// starts over. Both are one batch and both are undoable. Dismiss hides it for the
// session without touching anything.
export function StalePlanNudge({ tasks }: { tasks: Task[] }) {
  const today = todayStr();
  const update = useUpdateTask();
  const { toast } = useToast();
  const [dismissed, setDismissed] = useState(false);

  const stale = useMemo(() => stalePlannedTasks(tasks, today), [tasks, today]);
  if (dismissed || stale.length === 0) return null;

  // Snapshot each task's planned_date so an undo restores exactly what was there,
  // rather than assuming it was any particular day.
  const snapshot = stale.map((t) => ({ id: t.id, planned_date: t.planned_date }));
  const restore = () =>
    snapshot.forEach((s) =>
      update.mutate({ id: s.id, body: { planned_date: s.planned_date } })
    );

  function clearPlans() {
    stale.forEach((t) => update.mutate({ id: t.id, body: { planned_date: null } }));
    setDismissed(true);
    toast(`Cleared ${stale.length} stale plan${stale.length === 1 ? "" : "s"}`, restore);
  }

  function keepToday() {
    stale.forEach((t) => update.mutate({ id: t.id, body: { planned_date: today } }));
    setDismissed(true);
    toast(`Re-planned ${stale.length} for today`, restore);
  }

  const n = stale.length;

  return (
    <div className="mb-4 rounded-xl border border-border bg-surface/40 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 text-sm text-foreground">
          {n === 1 ? "1 task has" : `${n} tasks have`} sat in Today for over{" "}
          {STALE_PLAN_DAYS} days.{" "}
          <span className="text-subtle">Still for today?</span>
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={keepToday}
            className="rounded-md border border-border px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Keep for today
          </button>
          <button
            type="button"
            onClick={clearPlans}
            className="rounded-md border border-border px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Clear
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setDismissed(true)}
            className="rounded-md px-1.5 py-1 text-xs text-subtle transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Not now
          </button>
        </div>
      </div>

      {/* The actual tasks, so the count is not a mystery you have to hunt for. */}
      <ul className="mt-2 space-y-0.5">
        {stale.slice(0, 4).map((t) => (
          <li key={t.id} className="truncate text-xs text-subtle">
            {t.title}
            <span className="ml-1.5 text-subtle/70">· {t.planned_date}</span>
          </li>
        ))}
        {n > 4 && <li className="text-xs text-subtle/70">and {n - 4} more</li>}
      </ul>
    </div>
  );
}
