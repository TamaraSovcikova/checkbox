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

// Today: due today OR overdue OR scheduled today OR planned for today OR ANY
// EARLIER day still not done ("Add to Today" that you did not finish) OR a
// CHECKPOINT is due (checkpoint_next <= today) OR carrying an open SUBTASK due
// today/overdue. Not done, not snoozed.
//
// The checkpoint clause is the pulse: a long-horizon task surfaces here on its
// checkpoint date to be marked on track, then rolls to the next (see
// shared/checkpoint). It leaves once acknowledged past the due date.
//
// `planned_date <= today`, not `= today`, so a task you planned and did not
// finish stays put when the day rolls over instead of silently vanishing at
// midnight. It mirrors the overdue rule for due dates (`due_date < today`): you
// said you would do this, you have not, so it is still on your plate. It leaves
// only when completed or explicitly removed (leaveTodayBody clears planned_date).
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
// STRICTLY `= ?`, unlike the parent's overdue rule: a subtask carries its parent
// into Today ON ITS DUE DAY ONLY. It used to be `<=`, and a task with a step due
// last Friday resurrected in Today every morning forever, surviving every
// "Remove from Today" (each removal only snoozes to tomorrow, and tomorrow the
// overdue step still matched). Her rule: once removed it stays out; a PAST step
// is the OVERDUE view's job, and that view carries the parent below.
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
       AND (due_date = ? OR due_date < ? OR substr(scheduled_start,1,10) = ? OR planned_date <= ?
            OR (checkpoint_next IS NOT NULL AND checkpoint_next <= ?)
            OR EXISTS (SELECT 1 FROM subtasks s
                        WHERE s.task_id = tasks.id AND s.done = 0
                          AND s.due_date IS NOT NULL AND s.due_date = ?))
       ${NOT_SNOOZED}
     ORDER BY due_time IS NULL, due_time, priority`,
    [userId, today, today, today, today, today, today, today]
  );
});

// Upcoming: everything dated ahead of today. That means due dates, and ALSO a
// task planned for a future day that carries no deadline at all.
//
// The planned clause is here because planned_date became a date you can SET
// (it used to be writable only as "today", by the Add to Today button). A task
// you deliberately planned for next Thursday and gave no deadline would
// otherwise appear on no forward-looking list: not here, not in Today until the
// day arrives, and not in the Backlog once it has an area. Planning it would
// have made it less visible than leaving it alone, which is the opposite of
// what a second date is for.
//
// Strictly `due_date IS NULL` on that side, so a task with both dates is listed
// once, on its DEADLINE, which is the date that orders a forward list. Ordering
// coalesces for the same reason: a plan-only task sorts by the only date it has.
views.get("/upcoming", async (c) => {
  const userId = await getUserId(c);
  const today = todayStr();
  return run(
    c,
    `SELECT * FROM tasks WHERE user_id = ? AND status != 'done' AND parent_task_id IS NULL
       AND (due_date > ? OR (due_date IS NULL AND planned_date > ?))
       ${NOT_SNOOZED}
     ORDER BY COALESCE(due_date, planned_date), due_time IS NULL, due_time, priority`,
    [userId, today, today, today]
  );
});

// Overdue carries a parent with an open PAST-DUE subtask too: when a step's day
// passes unfinished, the parent moves here from Today (whose subtask clause is
// strictly same-day). The task row's "N subtasks overdue" chip says why.
views.get("/overdue", async (c) => {
  const userId = await getUserId(c);
  const today = todayStr();
  return run(
    c,
    `SELECT * FROM tasks WHERE user_id = ? AND status != 'done' AND parent_task_id IS NULL
       AND (due_date < ?
            OR EXISTS (SELECT 1 FROM subtasks s
                        WHERE s.task_id = tasks.id AND s.done = 0
                          AND s.due_date IS NOT NULL AND s.due_date < ?))
       ${NOT_SNOOZED}
     ORDER BY due_date IS NULL, due_date, priority`,
    [userId, today, today, today]
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
       -- A "whenever" task is not waiting to be filed, it is already where it
       -- belongs (see /whenever). Leaving it here too would make the Backlog the
       -- thing the flag exists to stop it being: a pile you avoid opening.
       AND whenever = 0
       ${NOT_SNOOZED}
     ORDER BY created_at DESC`,
    [userId, today, today]
  );
});

// Whenever: things with no date and no intention of having one. Hobby goals,
// articles to read, curiosities. The pool you open when you have an hour and no
// obligation, which is the whole reason the flag exists: a marker with nowhere
// to go would just be a boolean you have to remember to filter by.
//
// Newest first, deliberately. There is no urgency to sort by, and the thing you
// wrote down last week is the thing you are still curious about.
views.get("/whenever", async (c) => {
  const userId = await getUserId(c);
  const today = todayStr();
  return run(
    c,
    `SELECT * FROM tasks WHERE user_id = ? AND status != 'done' AND parent_task_id IS NULL
       AND whenever = 1
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
