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

// A snoozed task (snoozed_until in the future) is hidden from the active views
// until its day arrives. Appended to each active view's WHERE clause.
const NOT_SNOOZED = "AND (snoozed_until IS NULL OR snoozed_until <= ?)";

// Today: due today OR scheduled today OR overdue, not done, not snoozed.
views.get("/today", async (c) => {
  const userId = await getUserId(c);
  const today = todayStr();
  return run(
    c,
    `SELECT * FROM tasks WHERE user_id = ? AND status != 'done' AND parent_task_id IS NULL
       AND (due_date = ? OR due_date < ? OR substr(scheduled_start,1,10) = ?)
       ${NOT_SNOOZED}
     ORDER BY due_time IS NULL, due_time, priority`,
    [userId, today, today, today, today]
  );
});

views.get("/upcoming", async (c) => {
  const userId = await getUserId(c);
  const today = todayStr();
  return run(
    c,
    `SELECT * FROM tasks WHERE user_id = ? AND status != 'done' AND parent_task_id IS NULL
       AND due_date > ?
       ${NOT_SNOOZED}
     ORDER BY due_date, due_time IS NULL, due_time, priority`,
    [userId, today, today]
  );
});

views.get("/overdue", async (c) => {
  const userId = await getUserId(c);
  const today = todayStr();
  return run(
    c,
    `SELECT * FROM tasks WHERE user_id = ? AND status != 'done' AND parent_task_id IS NULL
       AND due_date < ?
       ${NOT_SNOOZED}
     ORDER BY due_date, priority`,
    [userId, today, today]
  );
});

views.get("/backlog", async (c) => {
  const userId = await getUserId(c);
  const today = todayStr();
  return run(
    c,
    `SELECT * FROM tasks WHERE user_id = ? AND status != 'done' AND parent_task_id IS NULL
       AND area_id IS NULL AND project_id IS NULL
       ${NOT_SNOOZED}
     ORDER BY created_at DESC`,
    [userId, today]
  );
});

// Snoozed: everything currently deferred to a future day, soonest first. Lets
// the user see and un-snooze what they hid.
views.get("/snoozed", async (c) => {
  const userId = await getUserId(c);
  const today = todayStr();
  return run(
    c,
    `SELECT * FROM tasks WHERE user_id = ? AND status != 'done' AND parent_task_id IS NULL
       AND snoozed_until IS NOT NULL AND snoozed_until > ?
     ORDER BY snoozed_until, priority`,
    [userId, today]
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
