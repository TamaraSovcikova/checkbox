import type { Task } from "./types";

// "Suggest for today": the zero-cost, no-AI half of plan-my-day. You click it
// when Today feels too empty, so it is deliberately NOT picky: it ranks EVERY
// eligible open task and always returns the best available, even when nothing is
// pressing. The score is what makes the ranking defensible (deadline pressure,
// then priority); the reason string explains the pick. Pure + deterministic
// (today is passed in) so it is unit-testable.
//
// Excluded only because they are already in Today or genuinely can't be worked:
//   - done
//   - planned for today, or time-blocked today  (already in Today)
//   - due today or overdue                       (already in Today via due_date)
//   - snoozed to a future day
//   - blocked by an unfinished dependency
// Everything else is a candidate, ranked. Empty result ⇒ there is truly nothing
// left to pull in.

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

    // Priority floor (P1=40 … P4=10). Everything eligible scores; no hard gate,
    // so an empty Today still gets the best of the backlog.
    let score = (5 - t.priority) * 10;
    let reason: string;

    if (dueIn !== null && dueIn <= HORIZON_DAYS) {
      // Approaching deadline: the strongest signal.
      score += dueIn === 1 ? 40 : dueIn === 2 ? 30 : 20;
      reason = dueIn === 1 ? "Due tomorrow" : `Due in ${dueIn} days`;
      if (t.priority <= 2) reason += ` · P${t.priority}`;
    } else if (dueIn !== null) {
      // Has a deadline, just further out: a mild nudge over no-deadline tasks.
      score += 5;
      reason = `Due ${t.due_date}${t.priority <= 2 ? ` · P${t.priority}` : ""}`;
    } else if (t.priority === 1) {
      reason = "P1 · urgent";
    } else if (t.priority === 2) {
      reason = "P2 · high priority";
    } else {
      reason = `P${t.priority} · no deadline`;
    }

    out.push({ task: t, score, reason });
  }

  // Highest score first; ties break to higher priority, then sooner due date so
  // the order is stable and sensible.
  out.sort(
    (a, b) =>
      b.score - a.score ||
      a.task.priority - b.task.priority ||
      (a.task.due_date ?? "9999").localeCompare(b.task.due_date ?? "9999")
  );
  return out.slice(0, limit);
}
