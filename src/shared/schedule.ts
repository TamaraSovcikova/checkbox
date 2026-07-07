// Pure, timezone-agnostic day scheduler shared by the client (lib/plan.ts, using
// local Date maths) and the Worker (lib/planner.ts, using tz-computed instants).
// Everything is epoch-milliseconds in and out so there is no Date/tz coupling
// here — the caller is responsible for building the window + busy intervals in
// whatever timezone it cares about.

export interface SchedTask {
  id: string;
  title: string;
  priority: number;
  estimateMin: number;
  dueTime: string | null; // "HH:MM", used only for ordering
}

export interface SchedBlock {
  task_id: string;
  title: string;
  priority: number;
  startMs: number;
  endMs: number;
}

export interface SchedResult {
  blocks: SchedBlock[];
  unscheduled: { id: string; title: string; priority: number }[];
}

export const DEFAULT_ESTIMATE_MIN = 30;
const GRANULARITY_MIN = 15;

function mergeBusy(intervals: { startMs: number; endMs: number }[]) {
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const merged: { startMs: number; endMs: number }[] = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.startMs <= last.endMs) {
      if (iv.endMs > last.endMs) last.endMs = iv.endMs;
    } else {
      merged.push({ startMs: iv.startMs, endMs: iv.endMs });
    }
  }
  return merged;
}

// Greedily drop tasks into the free gaps between busy intervals inside
// [windowStartMs, windowEndMs). Tasks are placed by priority, then earlier
// due-time, then heavier first. Tasks that don't fit come back as `unscheduled`.
export function scheduleBlocks(
  tasks: SchedTask[],
  busyRaw: { startMs: number; endMs: number }[],
  windowStartMs: number,
  windowEndMs: number,
  granularityMin = GRANULARITY_MIN
): SchedResult {
  const step = granularityMin * 60000;
  let cursor = Math.ceil(windowStartMs / step) * step;
  const busy = mergeBusy(busyRaw);

  const ordered = [...tasks].sort(
    (a, b) =>
      a.priority - b.priority ||
      (a.dueTime ?? "99:99").localeCompare(b.dueTime ?? "99:99") ||
      (b.estimateMin || DEFAULT_ESTIMATE_MIN) - (a.estimateMin || DEFAULT_ESTIMATE_MIN)
  );

  function skipBusy(from: number): number {
    let c = from;
    let moved = true;
    while (moved) {
      moved = false;
      for (const iv of busy) {
        if (c >= iv.startMs && c < iv.endMs) {
          c = iv.endMs;
          moved = true;
        }
      }
    }
    return c;
  }

  const blocks: SchedBlock[] = [];
  const unscheduled: SchedResult["unscheduled"] = [];

  for (const t of ordered) {
    const durMs = (t.estimateMin || DEFAULT_ESTIMATE_MIN) * 60000;
    cursor = skipBusy(cursor);
    let placed = false;
    while (cursor + durMs <= windowEndMs) {
      const end = cursor + durMs;
      const collision = busy.find((iv) => cursor < iv.endMs && end > iv.startMs);
      if (!collision) {
        blocks.push({
          task_id: t.id,
          title: t.title,
          priority: t.priority,
          startMs: cursor,
          endMs: end,
        });
        cursor = end;
        placed = true;
        break;
      }
      cursor = skipBusy(collision.endMs);
    }
    if (!placed)
      unscheduled.push({ id: t.id, title: t.title, priority: t.priority });
  }

  return { blocks, unscheduled };
}
