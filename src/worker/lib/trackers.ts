import { uuid, now } from "../db";
import { emittedTaskTitle } from "../../shared/tracker";
import { todayFor } from "./tz";

export { emittedTaskTitle };

// Turning an overdue cadence tracker into a real task.
//
// Trackers are gauges, not work. But "you have not called Ivka in three weeks"
// eventually IS work, and when it is, it belongs in the task list with
// everything else rather than in a second place to look. This is the seam that
// lets both be true: the gauge stays a gauge, and Checkbox stays the single
// store for action.

// Whole calendar days between two YYYY-MM-DD days, UTC so a DST boundary cannot
// round the wrong way. Mirrors client/lib/cadence.ts and mcp.ts; keep in step.
export function daysBetweenDays(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export type EmitCandidate = {
  id: string;
  name: string;
  area_id: string | null;
  target_days: number | null;
  last_at: string | null;
  open_tasks: number;
  task_title: string | null;
};

// Should this tracker emit a task right now?
//
// Pure, so the rule can be tested without a database. Four ways to say no:
//   - no target, so it can never be "past" anything (that is what a null target
//     means: count it, do not nag)
//   - not yet at the target
//   - it already has an open task, so emitting again would just stack duplicates
//     day after day while the first one sits there
//   - auto_task is off, checked by the caller's query
//
// A tracker that has NEVER been logged and has a target does emit: never having
// started is exactly the case worth a nudge.
export function shouldEmitTask(t: EmitCandidate, today: string): boolean {
  if (t.target_days == null) return false;
  if (t.open_tasks > 0) return false;
  if (t.last_at == null) return true;
  return daysBetweenDays(t.last_at.slice(0, 10), today) >= t.target_days;
}

// Today in the user's zone.

// Emit tasks for every opted-in tracker that is past its cadence. Returns the
// ids created, so the caller (and the tests) can see what happened.
//
// Runs on the 06:00 tick, before the morning brief, so a cadence that came due
// overnight is in the day's list when the brief announces it.
export async function emitTrackerTasks(
  db: D1Database,
  userId: string
): Promise<string[]> {
  const today = (await todayFor(db, userId));

  const { results } = await db
    .prepare(
      `SELECT t.id, t.name, t.area_id, t.target_days, t.task_title,
              (SELECT MAX(e.occurred_at) FROM tracker_events e WHERE e.tracker_id = t.id) AS last_at,
              (SELECT COUNT(*) FROM tasks k
                WHERE k.tracker_id = t.id AND k.status != 'done') AS open_tasks
         FROM trackers t
        WHERE t.user_id = ? AND t.archived = 0 AND t.auto_task = 1`
    )
    .bind(userId)
    .all<EmitCandidate>();

  const due = (results ?? []).filter((t) => shouldEmitTask(t, today));
  const created: string[] = [];

  for (const t of due) {
    const id = uuid();
    // Due today rather than merely planned, because it genuinely is: it has
    // already passed the interval the user asked for.
    await db
      .prepare(
        `INSERT INTO tasks (id, user_id, title, area_id, due_date, priority, status, tracker_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 3, 'todo', ?, ?, ?)`
      )
      .bind(id, userId, emittedTaskTitle(t), t.area_id, today, t.id, now(), now())
      .run();
    created.push(id);
  }

  return created;
}

// Ticking off a task that came from a tracker IS the occurrence. Without this
// you would tick the task and then separately press Log, and the gauge would sit
// there claiming you had not called anyone.
//
// The event records which task caused it, so un-completing can remove exactly
// that event rather than guessing at the most recent one.
export async function logTrackerForTask(
  db: D1Database,
  userId: string,
  taskId: string,
  trackerId: string
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO tracker_events (id, user_id, tracker_id, occurred_at, task_id) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(uuid(), userId, trackerId, now(), taskId)
    .run();
}

// Re-opening the task un-does the occurrence it created. Scoped to task_id, so a
// separate Log you pressed by hand survives.
export async function unlogTrackerForTask(
  db: D1Database,
  userId: string,
  taskId: string
): Promise<void> {
  await db
    .prepare("DELETE FROM tracker_events WHERE user_id = ? AND task_id = ?")
    .bind(userId, taskId)
    .run();
}
