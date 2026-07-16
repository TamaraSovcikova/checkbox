import { useEffect, useState } from "react";
import type { Task } from "../../shared/types";
import { api } from "../lib/api";
import { useTaskInvalidate } from "../lib/queries";
import { PlayIcon, StopIcon } from "../lib/icons";
import { cn } from "@/lib/utils";

function fmtMin(total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Start/stop time tracking and show actual-vs-estimate. The running timer ticks
// client-side from timer_started_at; stopping folds the elapsed into
// time_spent_min server-side (whole minutes).
export function TimeTracker({ task }: { task: Task }) {
  const invalidate = useTaskInvalidate();
  const [local, setLocal] = useState(task);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => setLocal(task), [task]);

  const running = !!local.timer_started_at;

  // Re-render every second while a timer runs so the elapsed clock advances.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const liveExtraMin = running
    ? Math.max(
        0,
        Math.floor((Date.now() - new Date(local.timer_started_at!).getTime()) / 60000)
      )
    : 0;
  const spent = local.time_spent_min + liveExtraMin;
  const estimate = local.time_estimate_min ?? 0;
  const over = estimate > 0 && spent > estimate;

  async function toggle() {
    setBusy(true);
    try {
      const updated = running
        ? await api.timerStop(local.id)
        : await api.timerStart(local.id);
      if (updated) setLocal(updated);
      invalidate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          disabled={busy}
          className={cn(
            "flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors disabled:opacity-50",
            running
              ? "border-danger/50 bg-danger/10 text-danger hover:bg-danger/20"
              : "border-input bg-surface text-foreground hover:border-primary/60"
          )}
        >
          {running ? (
            <>
              <StopIcon className="h-3.5 w-3.5" /> Stop
            </>
          ) : (
            <>
              <PlayIcon className="h-3.5 w-3.5" /> Start
            </>
          )}
        </button>
        <div className="text-sm tabular-nums">
          <span className={cn("font-medium", over ? "text-danger" : "text-foreground")}>
            {fmtMin(spent)}
          </span>
          {estimate > 0 && (
            <span className="text-subtle"> / {fmtMin(estimate)} est</span>
          )}
          {running && (
            <span className="ml-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-danger align-middle" />
          )}
        </div>
      </div>
      {estimate > 0 && (
        <div className="mt-1.5 h-1 max-w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className={cn("h-full rounded-full transition-all", over ? "bg-danger" : "bg-primary")}
            style={{ width: `${Math.min(100, Math.round((spent / estimate) * 100))}%` }}
          />
        </div>
      )}
    </div>
  );
}
