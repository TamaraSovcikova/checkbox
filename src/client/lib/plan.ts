import type { CalendarEvent, Task } from "../../shared/types";
import { scheduleBlocks, DEFAULT_ESTIMATE_MIN } from "../../shared/schedule";

// Client "plan my day" wrapper. Runs in the browser so it can use the real local
// timezone (the server stores calendar events as UTC instants). Builds the work
// window + busy intervals from local Date maths, then delegates the greedy fit to
// the shared, tz-agnostic scheduleBlocks (also used by the Worker's ambient
// planner) so both surfaces schedule identically.

export interface PlanSlot {
  task: Task;
  start: Date;
  end: Date;
}

export interface PlanResult {
  slots: PlanSlot[];
  unscheduled: Task[];
  window: { start: Date; end: Date };
}

function atHour(day: Date, hour: number): Date {
  const d = new Date(day);
  d.setHours(hour, 0, 0, 0);
  return d;
}

export function planDay(
  tasks: Task[],
  events: CalendarEvent[],
  opts: { now?: Date; workStartHour?: number; workEndHour?: number } = {}
): PlanResult {
  const now = opts.now ?? new Date();
  const dayStart = atHour(now, opts.workStartHour ?? 9);
  const dayEnd = atHour(now, opts.workEndHour ?? 18);
  const windowStart = now > dayStart ? now : dayStart;

  const busy: { startMs: number; endMs: number }[] = [];
  for (const e of events) {
    if (e.all_day) continue;
    const s = new Date(e.start).getTime();
    const en = new Date(e.end).getTime();
    if (isNaN(s) || isNaN(en)) continue;
    if (en <= dayStart.getTime() || s >= dayEnd.getTime()) continue;
    busy.push({ startMs: s, endMs: en });
  }

  const schedulable: Task[] = [];
  const byId = new Map<string, Task>();
  for (const t of tasks) {
    if (t.status === "done") continue;
    byId.set(t.id, t);
    if (t.scheduled_start && t.scheduled_end) {
      const s = new Date(t.scheduled_start).getTime();
      const en = new Date(t.scheduled_end).getTime();
      if (!isNaN(s) && !isNaN(en)) {
        busy.push({ startMs: s, endMs: en });
        continue;
      }
    }
    schedulable.push(t);
  }

  const res = scheduleBlocks(
    schedulable.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      estimateMin: t.time_estimate_min ?? DEFAULT_ESTIMATE_MIN,
      dueTime: t.due_time,
    })),
    busy,
    windowStart.getTime(),
    dayEnd.getTime()
  );

  return {
    slots: res.blocks.map((b) => ({
      task: byId.get(b.task_id)!,
      start: new Date(b.startMs),
      end: new Date(b.endMs),
    })),
    unscheduled: res.unscheduled.map((u) => byId.get(u.id)!).filter(Boolean),
    window: { start: dayStart, end: dayEnd },
  };
}
