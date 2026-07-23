import type { Task } from "../../shared/types";

// A task is blocked when it waits on an unfinished dependency OR its date-block
// (blocked_until) is still in the future. Both surfaces (row badge, sheet) read
// these so "blocked" means the same thing everywhere.

export function openBlockerCount(task: Task): number {
  return (task.depends_on ?? []).filter((d) => d.status !== "done").length;
}

// True while today is still before blocked_until.
export function dateBlocked(task: Task, today: string): boolean {
  return task.blocked_until != null && task.blocked_until > today;
}

export function isBlocked(task: Task, today: string): boolean {
  if (task.status === "done") return false;
  return openBlockerCount(task) > 0 || dateBlocked(task, today);
}

// Short label for the blocked chip: prefers the wait-until date, else the count.
export function blockedLabel(task: Task, today: string): string | null {
  if (task.status === "done") return null;
  const n = openBlockerCount(task);
  if (dateBlocked(task, today)) {
    return n > 0 ? `until ${task.blocked_until} +${n}` : `until ${task.blocked_until}`;
  }
  if (n > 0) return `${n} blocker${n > 1 ? "s" : ""}`;
  return null;
}

// ── Waiting on an external event ─────────────────────────────────────────────
// Not a block: the task stays fully visible. The chip states what it waits on;
// once the expected date passes it flips into a chase nudge, because at that
// point the useful action is chasing the sender, not more waiting.

export type WaitingChip = { kind: "waiting" | "chase"; label: string };

export function waitingChip(
  task: Pick<Task, "status" | "waiting_on" | "waiting_expected">,
  today: string
): WaitingChip | null {
  if (task.status === "done") return null;
  const what = task.waiting_on?.trim();
  if (!what) return null;
  if (task.waiting_expected && task.waiting_expected < today) {
    return { kind: "chase", label: `chase: ${what}` };
  }
  return { kind: "waiting", label: `waiting: ${what}` };
}
