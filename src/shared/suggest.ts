import type { Task } from "./types";

// "Suggest for today" — the zero-cost, no-AI half of plan-my-day. It ranks the
// open tasks that are NOT already surfaced in Today by how much they deserve a
// spot today: an approaching deadline or a high priority. Pure + deterministic
// (today is passed in) so it is unit-testable.
//
// Excluded, because they are already in Today or should not be pulled in:
//   - done
//   - planned for today, or time-blocked today  (already in Today)
//   - due today or overdue                       (already in Today via due_date)
//   - snoozed to a future day
//   - blocked by an unfinished dependency

export type Suggestion = { task: Task; score: number; reason: string };

const HORIZON_DAYS = 3;

function daysBetween(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

function isBlocked(t: Task): boolean {
  return (t.depends_on ?? []).some((d) => d.status !== "done");
}

export function suggestForToday(
  tasks: Task[],
  todayStr: string,
  limit = 6
): Suggestion[] {
  const out: Suggestion[] = [];

  for (const t of tasks) {
    if (t.status === "done") continue;
    if (t.planned_date === todayStr) continue;
    if (t.scheduled_start?.slice(0, 10) === todayStr) continue;
    if (t.snoozed_until && t.snoozed_until > todayStr) continue;
    if (isBlocked(t)) continue;

    const dueIn = t.due_date ? daysBetween(todayStr, t.due_date) : null;
    if (dueIn !== null && dueIn <= 0) continue; // due today / overdue: already in Today

    const dueSoon = dueIn !== null && dueIn <= HORIZON_DAYS;
    const highPriority = t.priority <= 2;
    if (!dueSoon && !highPriority) continue; // no reason to pull it into today

    // Priority floor (P1=40 … P4=10) plus a deadline bump for anything due soon.
    let score = (5 - t.priority) * 10;
    let reason: string;
    if (dueSoon && dueIn !== null) {
      score += dueIn === 1 ? 40 : dueIn === 2 ? 30 : 20;
      reason = dueIn === 1 ? "Due tomorrow" : `Due in ${dueIn} days`;
      if (highPriority) reason += ` · P${t.priority}`;
    } else {
      reason = t.priority === 1 ? "P1 · urgent" : `P${t.priority}, no deadline`;
    }
    out.push({ task: t, score, reason });
  }

  out.sort((a, b) => b.score - a.score || a.task.priority - b.task.priority);
  return out.slice(0, limit);
}
