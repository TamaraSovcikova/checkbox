import type { Subtask, Task } from "../../shared/types";

// A task is in Today ON ITS OWN ACCOUNT for any of these reasons: planned for
// today or any earlier day and still open, due today or overdue, or time-blocked
// today.
//
// `planned_date <= today` (not `= today`) so an unfinished plan carries forward
// instead of dropping out at midnight; mirrors the server's /views/today. Keep
// the two in sync.
//
// This is the rule the Add/Remove Today toggle is bound to, and that is why it
// deliberately does NOT include "has a subtask due today" (see below). Every
// reason listed here is one leaveTodayBody can clear; a subtask's due date is
// not. Folding it in would give a task a lit "Remove from Today" button that
// silently could not remove it.
export function inToday(task: Task, today: string): boolean {
  if (task.planned_date != null && task.planned_date <= today) return true;
  if (task.due_date != null && task.due_date <= today) return true;
  if (task.scheduled_start != null && task.scheduled_start.slice(0, 10) === today)
    return true;
  return false;
}

// The open subtasks that are themselves due (today or overdue). The work you owe
// today is not always a whole task: a task due next month can have one step due
// now, and that step used to be invisible outside the task sheet.
export function subtasksDueBy(task: Task, today: string): Subtask[] {
  return (task.subtasks ?? []).filter(
    (s) => !s.done && s.due_date != null && s.due_date <= today
  );
}

export const hasSubtaskDueToday = (task: Task, today: string): boolean =>
  subtasksDueBy(task, today).length > 0;

// Everything the Today VIEW holds: the task's own reasons, plus a task carried in
// by one of its subtasks. Mirrors the server's /views/today; keep the two in sync.
//
// Split from inToday on purpose, so a task pulled in by a subtask still reads as
// "Add to Today" (it is not planned; adding it is a real, additive action) rather
// than offering a Remove that cannot work.
export const inTodayView = (task: Task, today: string): boolean =>
  inToday(task, today) || hasSubtaskDueToday(task, today);

// The update body that removes a task from Today for good: clear EVERY trigger
// (the today plan, a today time-block, and a today/overdue deadline). Area and
// project are left untouched, so the task falls back to its section, or to the
// Backlog when it has neither. Returns only the fields that actually change, so
// the caller can snapshot exactly those for an undo.
export function leaveTodayBody(task: Task, today: string): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  // `<= today` matches inToday: a carried-over plan (planned on an earlier day,
  // still open) is cleared by Remove too, otherwise the button would leave it in
  // Today and read as doing nothing.
  if (task.planned_date != null && task.planned_date <= today) body.planned_date = null;
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
