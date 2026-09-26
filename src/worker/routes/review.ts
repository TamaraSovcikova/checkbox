import { Hono } from "hono";
import { type Bindings, getUserId } from "../db";
import { todayFor } from "../lib/tz";

export const review = new Hono<{ Bindings: Bindings }>();


function addDaysStr(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Weekly review: what got done, what slipped (past-due still open), what's
// coming up in the next 7 days, and a per-area completion breakdown. Read-only
// aggregation: the UI screen renders it; no writes here.
review.get("/", async (c) => {
  const userId = await getUserId(c);
  const today = (await todayFor(c.env.DB, userId));
  const weekAgo = addDaysStr(today, -7);
  const weekAhead = addDaysStr(today, 7);

  const [completedRes, slippedRes, upcomingRes, createdRes, byAreaRes, parkedRes] =
    await Promise.all([
      c.env.DB.prepare(
        `SELECT id, title, status, completed_at FROM tasks
          WHERE user_id = ? AND status = 'done' AND completed_at >= ?
          ORDER BY completed_at DESC LIMIT 100`
      )
        .bind(userId, weekAgo + "T00:00:00.000Z")
        .all(),
      c.env.DB.prepare(
        `SELECT id, title, status, due_date FROM tasks
          WHERE user_id = ? AND status != 'done' AND parent_task_id IS NULL
            AND due_date IS NOT NULL AND due_date < ?
          ORDER BY due_date, priority LIMIT 100`
      )
        .bind(userId, today)
        .all(),
      c.env.DB.prepare(
        `SELECT id, title, status, due_date FROM tasks
          WHERE user_id = ? AND status != 'done' AND parent_task_id IS NULL
            AND due_date >= ? AND due_date <= ?
            AND (snoozed_until IS NULL OR snoozed_until <= ?)
          ORDER BY due_date, priority LIMIT 100`
      )
        .bind(userId, today, weekAhead, today)
        .all(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS cnt FROM tasks
          WHERE user_id = ? AND created_at >= ?`
      )
        .bind(userId, weekAgo + "T00:00:00.000Z")
        .first<{ cnt: number }>(),
      c.env.DB.prepare(
        `SELECT COALESCE(a.name, 'No area') AS area, COUNT(*) AS completed
           FROM tasks t LEFT JOIN areas a ON a.id = t.area_id
          WHERE t.user_id = ? AND t.status = 'done' AND t.completed_at >= ?
          GROUP BY area ORDER BY completed DESC`
      )
        .bind(userId, weekAgo + "T00:00:00.000Z")
        .all<{ area: string; completed: number }>(),
      // Parked: not part of the week, deliberately. Everything else here is
      // "what happened in the last seven days"; this is the standing pile of
      // decisions that no view will ever show you again on its own.
      c.env.DB.prepare(
        `SELECT COUNT(*) AS cnt, MIN(parked_at) AS oldest FROM tasks
          WHERE user_id = ? AND status != 'done' AND parked_at IS NOT NULL`
      )
        .bind(userId)
        .first<{ cnt: number; oldest: string | null }>(),
    ]);

  return c.json({
    period: { from: weekAgo, to: today },
    stats: {
      completed: completedRes.results.length,
      slipped: slippedRes.results.length,
      upcoming: upcomingRes.results.length,
      created: createdRes?.cnt ?? 0,
      // Parked tasks appear in no list and nothing brings them back, so the one
      // moment they can honestly be reconsidered is the moment you are already
      // reconsidering things. A count, not the tasks: the review is for noticing
      // that six decisions are sitting unexamined, not for re-reading them here.
      parked: parkedRes?.cnt ?? 0,
      // ...and how long the oldest has sat, because "6 parked" is a fact and
      // "6 parked, oldest 8 months" is a prompt.
      parked_oldest: parkedRes?.oldest ?? null,
    },
    completed_tasks: completedRes.results,
    slipped_tasks: slippedRes.results,
    upcoming_tasks: upcomingRes.results,
    by_area: byAreaRes.results.map((r) => ({
      area: r.area,
      completed: Number(r.completed),
    })),
  });
});
