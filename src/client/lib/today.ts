import type { Subtask, Task } from "../../shared/types";
import { addDays } from "../../shared/recurrence";

// A task is in Today ON ITS OWN ACCOUNT for any of these reasons: planned for
// today or any earlier day and still open, due today or overdue, or time-blocked
// today.
//
// `planned_date <= today` (not `= today`) so an unfinished plan carries forward
// instead of dropping out at midnight; mirrors the server's /views/today. Keep
// the two in sync.
//
// These are the reasons leaveTodayBody can CLEAR outright. They are not the
// whole story of the Today view (a subtask due today or a due checkpoint also
// carries a task in, see inTodayView below); the toggle is bound to inTodayView,
// and for those two reasons Remove defers rather than clears.
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

// Strictly DUE TODAY, unlike subtasksDueBy above: a subtask carries its parent
// into the Today view on its due day only. Overdue steps used to count too, and
// a task with a step due last Friday resurrected in Today every morning forever,
// surviving every Remove (each removal only snoozes to tomorrow). A past step is
// the Overdue view's job now; the chips above still name it wherever the task
// shows. Mirrors the server's /views/today; keep the two in sync.
export const hasSubtaskDueToday = (task: Task, today: string): boolean =>
  (task.subtasks ?? []).some((s) => !s.done && s.due_date === today);

// The steps themselves, in list order. A task carried into Today by its steps
// RENDERS as those steps (see TaskRow's subtask-led layout), so the row needs
// the list and not just the boolean above.
export const subtasksDueToday = (task: Task, today: string): Subtask[] =>
  (task.subtasks ?? []).filter((s) => !s.done && s.due_date === today);

// In the Today view ONLY because a step is due: the step is the work and the
// task is its context. This is the one condition that changes how a row is
// drawn, so it lives here beside the rules it is made of rather than in the
// component.
export const isSubtaskLed = (task: Task, today: string): boolean =>
  task.status !== "done" && hasSubtaskDueToday(task, today) && !inToday(task, today);

// A checkpoint pulse is due: the task is in Today to be marked on track. Like a
// subtask due, this is not a reason leaveTodayBody can clear outright (the
// checkpoint schedule and the subtask's deadline are real data); Remove handles
// both by snoozing the task to tomorrow instead.
export const hasCheckpointDue = (task: Task, today: string): boolean =>
  task.checkpoint_next != null && task.checkpoint_next <= today;

// Whole days between two YYYY-MM-DD days. UTC so a DST boundary cannot make a day
// 23 or 25 hours long and round the wrong way (see lib/cadence, lib/due).
function daysAgo(day: string, today: string): number {
  const [dy, dm, dd] = day.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(dy, dm - 1, dd)) / 86_400_000);
}

// Tasks that are in Today ONLY because of an old plan, and by now a STALE one.
//
// Carry-forward (planned_date <= today) keeps an unfinished plan in Today
// indefinitely, which is right up to a point; past `days` it is worth asking
// whether it still belongs there. This is deliberately narrow: a task that is
// also due/overdue or time-blocked today belongs in Today for a reason clearing
// the plan would not remove, so it is excluded. What remains is exactly the set
// where "clear the plan" actually drops it out.
export const STALE_PLAN_DAYS = 14;

export function stalePlannedTasks(
  tasks: Task[],
  today: string,
  days = STALE_PLAN_DAYS
): Task[] {
  return tasks.filter(
    (t) =>
      t.status !== "done" &&
      t.planned_date != null &&
      daysAgo(t.planned_date, today) >= days &&
      t.due_date == null &&
      t.scheduled_start == null
  );
}

// Everything the Today VIEW holds: the task's own reasons, plus a task carried in
// by one of its subtasks or a due checkpoint. Mirrors the server's /views/today;
// keep the two in sync.
//
// This is the rule the Add/Remove Today toggle is bound to: if the view shows the
// task, the button must be able to take it out. It used to be bound to inToday
// alone, on the theory that a subtask-carried task should read "Add to Today"
// because Remove could not clear a subtask's deadline. The mixed case broke that:
// a task planned for today AND carrying a due subtask offered Remove, cleared the
// plan, toasted success, and stayed in the view. Remove now defers what it cannot
// clear (see leaveTodayBody), so the lit state and the view agree by definition.
export const inTodayView = (task: Task, today: string): boolean =>
  inToday(task, today) ||
  hasSubtaskDueToday(task, today) ||
  hasCheckpointDue(task, today);

// The update body that removes a task from Today for good: clear EVERY trigger it
// is safe to clear (the today plan, a today time-block, and a today/overdue
// deadline). The two reasons that are NOT safe to clear (a subtask's own
// deadline, a checkpoint schedule) are real data; when one of those would still
// hold the task in the view, snooze it to tomorrow instead. The Today view
// already hides snoozed tasks, so Remove works for every task the view can show,
// and the deferred reason comes back tomorrow, still true. Area and project are
// left untouched, so the task falls back to its section, or to the Backlog when
// it has neither. Returns only the fields that actually change, so the caller
// can snapshot exactly those for an undo.
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
  if (hasSubtaskDueToday(task, today) || hasCheckpointDue(task, today)) {
    body.snoozed_until = addDays(today, 1);
  }
  return body;
}

// The previous values of whatever leaveTodayBody would change, for a one-tap
// undo. `?? null` and not the raw value: every field here is a nullable column,
// and a snapshot that simply lacks the key (undefined) must still serialize into
// the PATCH body, or the undo silently skips that field. JSON.stringify drops
// undefined; it keeps null.
export function undoLeaveTodayBody(
  task: Task,
  changed: Record<string, unknown>
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of Object.keys(changed)) {
    body[key] = (task as unknown as Record<string, unknown>)[key] ?? null;
  }
  return body;
}
