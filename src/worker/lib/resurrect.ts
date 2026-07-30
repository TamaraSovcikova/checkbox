// The 06:00 sweep that wakes recurring tasks completed on an earlier day.
//
// Completing a recurring task now genuinely completes it: it sits crossed out
// in today's Done, counts in the stats, and rests until this sweep rolls it to
// its next occurrence the following morning. The immediate-roll it replaces
// made a finished daily task vanish and instantly resurface "due tomorrow".
// Runs BEFORE the planner in the cron chain, so today's plan already sees the
// resurrected tasks.

import type { Bindings } from "../db";
import { now } from "../db";
import { resurrectionDecision } from "../../shared/recurrence";
import { pushTaskToGcal } from "./sync";

function todayBrussels(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function resurrectRecurring(
  env: Bindings,
  today = todayBrussels()
): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT id, user_id, recurrence, recurrence_mode, due_date, completed_at,
            recurrence_until, recurrence_count
       FROM tasks
      WHERE status = 'done' AND recurrence IS NOT NULL
        AND completed_at IS NOT NULL AND substr(completed_at, 1, 10) < ?`
  )
    .bind(today)
    .all<{
      id: string;
      user_id: string;
      recurrence: string;
      recurrence_mode: "fixed" | "after_completion" | null;
      due_date: string | null;
      completed_at: string;
      recurrence_until: string | null;
      recurrence_count: number | null;
    }>();

  let woken = 0;
  for (const t of results ?? []) {
    const decision = resurrectionDecision(
      t.recurrence,
      t.recurrence_mode,
      t.due_date,
      t.completed_at.slice(0, 10),
      t.recurrence_until,
      t.recurrence_count,
      today
    );
    if (decision.kind === "roll") {
      // Wake as the next occurrence: open again, fresh checklist, no leftover
      // plan or time block from the completed instance.
      await env.DB.prepare(
        `UPDATE tasks SET status = 'todo', completed_at = NULL, due_date = ?,
           recurrence_count = ?, planned_date = NULL, scheduled_start = NULL,
           scheduled_end = NULL, updated_at = ? WHERE id = ?`
      )
        .bind(decision.due_date, decision.recurrence_count, now(), t.id)
        .run();
      await env.DB.prepare("UPDATE subtasks SET done = 0 WHERE task_id = ?")
        .bind(t.id)
        .run();
      await pushTaskToGcal(env, t.id, t.user_id).catch(console.error);
      woken++;
    } else {
      // The series is over (past `until` or the count ran out): the task stays
      // done and the recurrence comes off so nothing resurrects it later.
      await env.DB.prepare(
        `UPDATE tasks SET recurrence = NULL, recurrence_until = NULL,
           recurrence_count = NULL, updated_at = ? WHERE id = ?`
      )
        .bind(now(), t.id)
        .run();
    }
  }
  return woken;
}
