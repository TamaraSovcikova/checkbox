import type { Task } from "../../shared/types";

// A task shows in the Today view for any of these reasons (mirrors the server's
// /views/today query): explicitly planned for today, due today or overdue, or
// time-blocked today. Keep the two in sync.
export function inToday(task: Task, today: string): boolean {
  if (task.planned_date === today) return true;
  if (task.due_date != null && task.due_date <= today) return true;
  if (task.scheduled_start != null && task.scheduled_start.slice(0, 10) === today)
    return true;
  return false;
}

// The update body that removes a task from Today for good: clear EVERY trigger
// (the today plan, a today time-block, and a today/overdue deadline). Area and
// project are left untouched, so the task falls back to its section - or to the
// Backlog when it has neither. Returns only the fields that actually change, so
// the caller can snapshot exactly those for an undo.
export function leaveTodayBody(task: Task, today: string): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (task.planned_date === today) body.planned_date = null;
  if (task.scheduled_start != null && task.scheduled_start.slice(0, 10) === today) {
    body.scheduled_start = null;
    body.scheduled_end = null;
  }
  if (task.due_date != null && task.due_date <= today) {
    body.due_date = null;
    if (task.due_time != null) body.due_time = null;
  }
  return body;
}

// The previous values of whatever leaveTodayBody would change, for a one-tap undo.
export function undoLeaveTodayBody(
  task: Task,
  changed: Record<string, unknown>
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of Object.keys(changed)) {
    body[key] = (task as unknown as Record<string, unknown>)[key];
  }
  return body;
}
