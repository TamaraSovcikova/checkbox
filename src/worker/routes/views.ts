import { Hono, type Context } from "hono";
import { type Bindings, getUserId } from "../db";
import { hydrateTasks } from "./_hydrate";

export const views = new Hono<{ Bindings: Bindings }>();

// Today (in user tz) as YYYY-MM-DD. Single-user default Europe/Brussels.
function todayStr(tz = "Europe/Brussels") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function run(
  c: Context<{ Bindings: Bindings }>,
  sql: string,
  binds: unknown[]
) {
  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return c.json(await hydrateTasks(c.env.DB, results as Record<string, unknown>[]));
}

// Today: due today OR scheduled today OR overdue, not done.
views.get("/today", async (c) => {
  const userId = await getUserId(c);
  const today = todayStr();
  return run(
    c,
    `SELECT * FROM tasks WHERE user_id = ? AND status != 'done' AND parent_task_id IS NULL
       AND (due_date = ? OR due_date < ? OR substr(scheduled_start,1,10) = ?)
     ORDER BY due_time IS NULL, due_time, priority`,
    [userId, today, today, today]
  );
});

views.get("/upcoming", async (c) => {
  const userId = await getUserId(c);
  const today = todayStr();
  return run(
    c,
    `SELECT * FROM tasks WHERE user_id = ? AND status != 'done' AND parent_task_id IS NULL
       AND due_date > ?
     ORDER BY due_date, due_time IS NULL, due_time, priority`,
    [userId, today]
  );
});

views.get("/overdue", async (c) => {
  const userId = await getUserId(c);
  const today = todayStr();
  return run(
    c,
    `SELECT * FROM tasks WHERE user_id = ? AND status != 'done' AND parent_task_id IS NULL
       AND due_date < ?
     ORDER BY due_date, priority`,
    [userId, today]
  );
});

views.get("/backlog", async (c) => {
  const userId = await getUserId(c);
  return run(
    c,
    `SELECT * FROM tasks WHERE user_id = ? AND status != 'done' AND parent_task_id IS NULL
       AND area_id IS NULL AND project_id IS NULL
     ORDER BY created_at DESC`,
    [userId]
  );
});

views.get("/logbook", async (c) => {
  const userId = await getUserId(c);
  return run(
    c,
    `SELECT * FROM tasks WHERE user_id = ? AND status = 'done' AND parent_task_id IS NULL
     ORDER BY completed_at DESC LIMIT 200`,
    [userId]
  );
});
