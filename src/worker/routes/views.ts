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

// Today: due today OR overdue OR scheduled today OR explicitly planned for today
// ("Add to Today") OR carrying an open SUBTASK due today/overdue. Not done, not
// snoozed.
//
// The subtask clause is here because the work you owe today is not always a whole
// task: a project task due next month can have one step due today, and before this
// that step was reachable only by opening the task. The PARENT is what surfaces,
// never a bare subtask row: the parent carries the context ("Tax return" then "post
// the form"), it is what the client can already render and tick inline, and Today
// stays a list of tasks rather than two kinds of thing. The row says why it is
// there (hasSubtaskDueToday on the client), because a task appearing in Today for
// a reason you cannot see is precisely how a filter becomes a bug report.
//
// `<= ?` mirrors the parent rule, which treats overdue as today's problem.
// Subtasks carry no user_id; the EXISTS is scoped through the outer task, which
// does, so this can never reach another user's rows.
//
// Keep in sync with the client mirror in lib/today.ts.
views.get("/today", async (c) => {
  const userId = await getUserId(c);
  const today = todayStr();
  return run(
    c,
    `SELECT * FROM tasks WHERE user_id = ? AND status != 'done' AND parent_task_id IS NULL
       AND (due_date = ? OR due_date < ? OR substr(scheduled_start,1,10) = ? OR planned_date = ?
            OR EXISTS (SELECT 1 FROM subtasks s
                        WHERE s.task_id = tasks.id AND s.done = 0
                          AND s.due_date IS NOT NULL AND s.due_date <= ?))
       ${NOT_SNOOZED}
     ORDER BY due_time IS NULL, due_time, priority`,
    [userId, today, today, today, today, today, today]
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

// Backlog: unfiled and not done. A task you have planned for today is actively
// being worked, so it does not sit in the Backlog as well (capturing from Today
// should land in Today, not the Backlog). It reappears here once the day passes,
// if it is still unfiled.
views.get("/backlog", async (c) => {
  const userId = await getUserId(c);
  const today = todayStr();
  return run(
    c,
    `SELECT * FROM tasks WHERE user_id = ? AND status != 'done' AND parent_task_id IS NULL
       AND area_id IS NULL AND project_id IS NULL
       AND (planned_date IS NULL OR planned_date <> ?)
       ${NOT_SNOOZED}
     ORDER BY created_at DESC`,
    [userId, today, today]
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

// Completed today: done tasks whose completion date is today (in user tz). Powers
// the "Completed" strip under Today: a same-day history you can un-check to
// restore. Naturally empties at midnight since it keys off today's date.
views.get("/completed-today", async (c) => {
  const userId = await getUserId(c);
  const today = todayStr();
  return run(
    c,
    `SELECT * FROM tasks WHERE user_id = ? AND status = 'done' AND parent_task_id IS NULL
       AND substr(completed_at, 1, 10) = ?
     ORDER BY completed_at DESC`,
    [userId, today]
  );
});
