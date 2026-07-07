import { useMemo, useState } from "react";
import { format } from "date-fns";
import type { Task } from "../../shared/types";
import { planDay, type PlanResult } from "../lib/plan";
import { useCalendarEvents, useCalendarStatus, useUpdateTask } from "../lib/queries";
import { useToast } from "../lib/toast";
import { PRIORITY_VAR } from "../lib/colors";
import { PlanIcon, CalendarIcon, ClockIcon } from "../lib/icons";
import { Button } from "./ui";

function todayStr() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// "Plan my day" — proposes time-blocks for today's open tasks around the
// calendar, then writes scheduled_start/end (which pushes to GCal) on Accept.
export function PlanMyDay({ tasks }: { tasks: Task[] }) {
  const [open, setOpen] = useState(false);
  const today = todayStr();
  const { data: cal } = useCalendarStatus();
  const { data: events = [] } = useCalendarEvents(today);
  const update = useUpdateTask();
  const { toast } = useToast();
  const [applying, setApplying] = useState(false);

  // Only tasks that actually belong to today's work and aren't already blocked
  // out. Recompute when the panel opens or inputs change.
  const plan: PlanResult = useMemo(
    () => planDay(tasks, events),
    [tasks, events]
  );

  const hasTasks = tasks.some((t) => t.status !== "done");

  async function accept() {
    setApplying(true);
    try {
      await Promise.all(
        plan.slots.map((s) =>
          update.mutateAsync({
            id: s.task.id,
            body: {
              scheduled_start: s.start.toISOString(),
              scheduled_end: s.end.toISOString(),
            },
          })
        )
      );
      toast(`Scheduled ${plan.slots.length} task${plan.slots.length !== 1 ? "s" : ""}`);
      setOpen(false);
    } finally {
      setApplying(false);
    }
  }

  if (!open) {
    return (
      <div className="mb-4 max-w-2xl">
        <Button
          variant="subtle"
          className="h-8 gap-1.5 text-xs"
          disabled={!hasTasks}
          onClick={() => setOpen(true)}
          title={hasTasks ? "Time-block today's tasks" : "Nothing to plan"}
        >
          <PlanIcon className="h-4 w-4 text-primary" />
          Plan my day
        </Button>
      </div>
    );
  }

  return (
    <div className="mb-4 max-w-2xl rounded-xl border border-border bg-surface/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PlanIcon className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Proposed schedule</span>
          <span className="text-xs text-subtle">
            {format(plan.window.start, "HH:mm")}–{format(plan.window.end, "HH:mm")}
          </span>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-subtle hover:text-foreground"
        >
          close
        </button>
      </div>

      {!cal?.connected && (
        <p className="mb-3 flex items-center gap-1.5 text-[11px] text-subtle">
          <CalendarIcon className="h-3.5 w-3.5" />
          Calendar not connected — planning around an empty day. Connect it in
          Settings to work around meetings.
        </p>
      )}

      {plan.slots.length === 0 ? (
        <p className="text-sm text-subtle">
          No room to schedule anything in the remaining work hours.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {plan.slots.map((s) => (
            <li
              key={s.task.id}
              className="flex items-center gap-3 rounded-md bg-surface px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-1 tabular-nums text-xs text-primary">
                <ClockIcon className="h-3.5 w-3.5" />
                {format(s.start, "HH:mm")}
              </span>
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: PRIORITY_VAR[s.task.priority] }}
              />
              <span className="flex-1 truncate text-foreground">{s.task.title}</span>
              <span className="text-[11px] text-subtle">
                {Math.round((s.end.getTime() - s.start.getTime()) / 60000)}m
              </span>
            </li>
          ))}
        </ol>
      )}

      {plan.unscheduled.length > 0 && (
        <p className="mt-2 text-[11px] text-subtle">
          {plan.unscheduled.length} didn&apos;t fit:{" "}
          {plan.unscheduled.map((t) => t.title).join(", ")}
        </p>
      )}

      {plan.slots.length > 0 && (
        <div className="mt-3 flex gap-2">
          <Button
            variant="primary"
            className="h-8 text-xs"
            disabled={applying}
            onClick={accept}
          >
            {applying ? "Scheduling…" : `Accept & schedule ${plan.slots.length}`}
          </Button>
          <Button
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => setOpen(false)}
          >
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}
