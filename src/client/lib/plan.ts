import type { CalendarEvent, Task } from "../../shared/types";

// Client-side "plan my day" scheduler. Runs in the browser so it can use the
// real local timezone (the server stores calendar events as UTC instants; doing
// this on the Worker would need a tz library). Greedily drops today's open tasks
// into the free gaps between calendar meetings within a work window.

export interface PlanSlot {
  task: Task;
  start: Date;
  end: Date;
}

export interface PlanResult {
  slots: PlanSlot[];
  unscheduled: Task[];
  busy: { start: Date; end: Date }[];
  window: { start: Date; end: Date };
}

const DEFAULT_ESTIMATE_MIN = 30;
const GRANULARITY_MIN = 15;

function roundUp(d: Date, stepMin: number): Date {
  const ms = stepMin * 60000;
  return new Date(Math.ceil(d.getTime() / ms) * ms);
}

function atHour(day: Date, hour: number): Date {
  const d = new Date(day);
  d.setHours(hour, 0, 0, 0);
  return d;
}

// Merge overlapping/adjacent busy intervals so gap-finding is simple.
function mergeBusy(intervals: { start: Date; end: Date }[]) {
  const sorted = [...intervals].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );
  const merged: { start: Date; end: Date }[] = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.start.getTime() <= last.end.getTime()) {
      if (iv.end.getTime() > last.end.getTime()) last.end = iv.end;
    } else {
      merged.push({ start: new Date(iv.start), end: new Date(iv.end) });
    }
  }
  return merged;
}

export function planDay(
  tasks: Task[],
  events: CalendarEvent[],
  opts: { now?: Date; workStartHour?: number; workEndHour?: number } = {}
): PlanResult {
  const now = opts.now ?? new Date();
  const dayStart = atHour(now, opts.workStartHour ?? 9);
  const dayEnd = atHour(now, opts.workEndHour ?? 18);
  // Don't schedule into the past — start from the next slot boundary after now.
  const windowStart = roundUp(now > dayStart ? now : dayStart, GRANULARITY_MIN);

  // Busy = timed calendar meetings + tasks that already have a time-block today.
  const busyRaw: { title: string; start: Date; end: Date }[] = [];
  for (const e of events) {
    if (e.all_day) continue;
    const s = new Date(e.start);
    const en = new Date(e.end);
    if (isNaN(s.getTime()) || isNaN(en.getTime())) continue;
    if (en <= dayStart || s >= dayEnd) continue;
    busyRaw.push({ title: e.title ?? "Busy", start: s, end: en });
  }
  const schedulable: Task[] = [];
  for (const t of tasks) {
    if (t.status === "done") continue;
    if (t.scheduled_start && t.scheduled_end) {
      const s = new Date(t.scheduled_start);
      const en = new Date(t.scheduled_end);
      if (!isNaN(s.getTime()) && !isNaN(en.getTime())) {
        busyRaw.push({ title: t.title, start: s, end: en });
        continue;
      }
    }
    schedulable.push(t);
  }

  const busy = mergeBusy(busyRaw);

  // Priority first, then earlier due-time, then heavier tasks earlier.
  schedulable.sort(
    (a, b) =>
      a.priority - b.priority ||
      (a.due_time ?? "99:99").localeCompare(b.due_time ?? "99:99") ||
      (b.time_estimate_min ?? DEFAULT_ESTIMATE_MIN) -
        (a.time_estimate_min ?? DEFAULT_ESTIMATE_MIN)
  );

  const slots: PlanSlot[] = [];
  const unscheduled: Task[] = [];
  let cursor = windowStart;

  // Advance the cursor past any busy interval it currently sits inside.
  function skipBusy(from: Date): Date {
    let c = from;
    let moved = true;
    while (moved) {
      moved = false;
      for (const iv of busy) {
        if (c >= iv.start && c < iv.end) {
          c = iv.end;
          moved = true;
        }
      }
    }
    return c;
  }

  for (const task of schedulable) {
    const durMs = (task.time_estimate_min ?? DEFAULT_ESTIMATE_MIN) * 60000;
    cursor = skipBusy(cursor);
    let placed = false;
    // Try to fit before the next busy interval; if it collides, jump past it.
    while (cursor.getTime() + durMs <= dayEnd.getTime()) {
      const end = new Date(cursor.getTime() + durMs);
      const collision = busy.find(
        (iv) => cursor < iv.end && end > iv.start
      );
      if (!collision) {
        slots.push({ task, start: new Date(cursor), end });
        cursor = end;
        placed = true;
        break;
      }
      cursor = skipBusy(collision.end);
    }
    if (!placed) unscheduled.push(task);
  }

  return {
    slots,
    unscheduled,
    busy,
    window: { start: dayStart, end: dayEnd },
  };
}
