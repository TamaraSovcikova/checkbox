import { Hono } from "hono";
import { type Bindings, getUserId } from "../db";

export const review = new Hono<{ Bindings: Bindings }>();

function todayStr(tz = "Europe/Brussels") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysStr(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Weekly review: what got done, what slipped (past-due still open), what's
// coming up in the next 7 days, and a per-area completion breakdown. Read-only
// aggregation - the UI screen renders it; no writes here.
review.get("/", async (c) => {
  const userId = await getUserId(c);
  const today = todayStr();
  const weekAgo = addDaysStr(today, -7);
  const weekAhead = addDaysStr(today, 7);

  const [completedRes, slippedRes, upcomingRes, createdRes, byAreaRes] =
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
    ]);

  return c.json({
    period: { from: weekAgo, to: today },
    stats: {
      completed: completedRes.results.length,
      slipped: slippedRes.results.length,
      upcoming: upcomingRes.results.length,
      created: createdRes?.cnt ?? 0,
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
