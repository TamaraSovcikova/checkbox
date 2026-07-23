import { Hono } from "hono";
import { type Bindings, getUserId, now, uuid } from "../db";
import { hydrateTasks } from "./_hydrate";
import { pushTaskToGcal, deleteTaskGcalEvent } from "../lib/sync";
import { logTrackerForTask, unlogTrackerForTask } from "../lib/trackers";
import { enforceProjectArea } from "../lib/section";
import { nextDueDate } from "../../shared/recurrence";

export const tasks = new Hono<{ Bindings: Bindings }>();

// Today (Europe/Brussels) as YYYY-MM-DD: the anchor for after-completion recurrence.
function todayStr(tz = "Europe/Brussels") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const WRITABLE = [
  "title",
  "notes",
  "priority",
  "due_date",
  "due_time",
  "time_estimate_min",
  "scheduled_start",
  "scheduled_end",
  "board_column",
  "section_id",
  "area_id",
  "project_id",
  "status",
  "position",
  "recurrence",
  "recurrence_mode",
  "snoozed_until",
  "planned_date",
  "blocked_until",
  "optional",
  "gcal_hidden",
  "checkpoint_days",
  "checkpoint_next",
];

// Does this task belong to this user? Used to gate subtask + label mutations.
async function ownsTask(
  db: D1Database,
  userId: string,
  taskId: string
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM tasks WHERE id = ? AND user_id = ?")
    .bind(taskId, userId)
    .first();
  return !!row;
}

// Reject writes that point area_id/project_id at rows the user doesn't own.
// Returns an error string, or null when the refs are clean.
async function badRefs(
  db: D1Database,
  userId: string,
  b: Record<string, unknown>
): Promise<string | null> {
  if (b.area_id) {
    const a = await db
      .prepare("SELECT 1 FROM areas WHERE id = ? AND user_id = ?")
      .bind(b.area_id, userId)
      .first();
    if (!a) return "area_id not found";
  }
  if (b.project_id) {
    const p = await db
      .prepare("SELECT 1 FROM projects WHERE id = ? AND user_id = ?")
      .bind(b.project_id, userId)
      .first();
    if (!p) return "project_id not found";
  }
  return null;
}

// LIST with filters: ?project_id= &area_id= &status= &backlog=1 &ids=a,b,c
tasks.get("/", async (c) => {
  const userId = await getUserId(c);
  const q = c.req.query();
  let sql = "SELECT * FROM tasks WHERE user_id = ? AND parent_task_id IS NULL";
  const binds: unknown[] = [userId];

  // ?ids= asks for specific tasks and answers with them whatever their status:
  // the caller already named the tasks it wants, so the "hide done" default
  // below would just lie to it. Pins resolving their linked tasks need this,
  // otherwise ticking a linked task off makes it look deleted.
  if (q.ids != null) {
    const ids = q.ids
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 200); // bound the IN list
    if (ids.length === 0) return c.json([]);
    sql += ` AND id IN (${ids.map(() => "?").join(",")})`;
    binds.push(...ids);
  }

  if (q.backlog === "1") sql += " AND area_id IS NULL AND project_id IS NULL";
  if (q.project_id) {
    sql += " AND project_id = ?";
    binds.push(q.project_id);
  }
  if (q.area_id) {
    sql += " AND area_id = ? AND project_id IS NULL";
    binds.push(q.area_id);
  }
  if (q.status) {
    sql += " AND status = ?";
    binds.push(q.status);
  } else if (q.ids == null) {
    sql += " AND status != 'done'";
  }
  sql += " ORDER BY position, priority, created_at";
  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return c.json(await hydrateTasks(c.env.DB, results as Record<string, unknown>[]));
});

// Full-text-ish search across the user's open tasks (title + notes). Powers the
// Cmd-K palette. Registered before /:id so "search" isn't read as a task id.
tasks.get("/search", async (c) => {
  const userId = await getUserId(c);
  const q = (c.req.query("q") ?? "").trim();
  if (!q) return c.json([]);
  const like = `%${q.replace(/[%_]/g, (m) => "\\" + m)}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM tasks
       WHERE user_id = ? AND parent_task_id IS NULL AND status != 'done'
         AND (title LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')
     ORDER BY (title LIKE ? ESCAPE '\\') DESC, priority, due_date
     LIMIT 20`
  )
    .bind(userId, like, like, like)
    .all();
  return c.json(await hydrateTasks(c.env.DB, results as Record<string, unknown>[]));
});

tasks.get("/:id", async (c) => {
  const userId = await getUserId(c);
  const row = await c.env.DB.prepare(
    "SELECT * FROM tasks WHERE id = ? AND user_id = ?"
  )
    .bind(c.req.param("id"), userId)
    .first();
  if (!row) return c.json({ error: "not found" }, 404);
  const [task] = await hydrateTasks(c.env.DB, [row as Record<string, unknown>]);
  return c.json(task);
});

tasks.post("/", async (c) => {
  const userId = await getUserId(c);
  const b = await c.req.json<Record<string, unknown>>();
  if (!(b.title as string)?.trim())
    return c.json({ error: "title required" }, 400);
  const refErr = await badRefs(c.env.DB, userId, b);
  if (refErr) return c.json({ error: refErr }, 400);
  // A task in a project belongs to that project's area, whatever the caller said.
  await enforceProjectArea(c.env.DB, userId, b);
  const id = uuid();
  const cols = ["id", "user_id", ...WRITABLE.filter((f) => f in b)];
  const vals = [id, userId, ...WRITABLE.filter((f) => f in b).map((f) => b[f])];
  const ph = cols.map(() => "?").join(",");
  await c.env.DB.prepare(
    `INSERT INTO tasks (${cols.join(",")}) VALUES (${ph})`
  )
    .bind(...vals)
    .run();
  // optional label names -> attach (create if missing)
  if (Array.isArray(b.labelNames)) {
    await attachLabelNames(c.env.DB, userId, id, b.labelNames as string[]);
  }
  const row = await c.env.DB.prepare("SELECT * FROM tasks WHERE id = ?")
    .bind(id)
    .first();
  const [task] = await hydrateTasks(c.env.DB, [row as Record<string, unknown>]);
  // Push to GCal if the task has a time-block or due date.
  if (b.scheduled_start || b.due_date) {
    c.executionCtx?.waitUntil(
      pushTaskToGcal(c.env, id, userId).catch(console.error)
    );
  }
  return c.json(task, 201);
});

tasks.patch("/:id", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  // Ownership gate: everything below (fields, labels) requires owning the task.
  if (!(await ownsTask(c.env.DB, userId, id)))
    return c.json({ error: "not found" }, 404);
  const b = await c.req.json<Record<string, unknown>>();
  const refErr = await badRefs(c.env.DB, userId, b);
  if (refErr) return c.json({ error: refErr }, 400);
  // Moving a task into a project moves it into that project's area too. Only
  // fires when the body actually names a project, so a title-only PATCH is
  // untouched.
  await enforceProjectArea(c.env.DB, userId, b);
  const fields = WRITABLE.filter((f) => f in b);
  if (fields.length) {
    let set = fields.map((f) => `${f} = ?`).join(", ");
    // A rescheduled task earns a fresh due-time reminder: the once-guard is
    // per (date, time), not per task forever.
    if (fields.includes("due_date") || fields.includes("due_time")) {
      set += ", reminder_sent_at = NULL";
    }
    await c.env.DB.prepare(
      `UPDATE tasks SET ${set}, updated_at = ? WHERE id = ? AND user_id = ?`
    )
      .bind(...fields.map((f) => b[f]), now(), id, userId)
      .run();
  }
  if (Array.isArray(b.labelNames)) {
    await c.env.DB.prepare("DELETE FROM task_labels WHERE task_id = ?")
      .bind(id)
      .run();
    await attachLabelNames(c.env.DB, userId, id, b.labelNames as string[]);
  }
  const row = await c.env.DB.prepare(
    "SELECT * FROM tasks WHERE id = ? AND user_id = ?"
  )
    .bind(id, userId)
    .first();
  const [task] = await hydrateTasks(c.env.DB, [row as Record<string, unknown>]);
  // Push to GCal if any scheduling/title field changed.
  const GCAL_FIELDS = [
    "scheduled_start",
    "scheduled_end",
    "due_date",
    "due_time",
    "title",
  ];
  if (fields.some((f) => GCAL_FIELDS.includes(f))) {
    c.executionCtx?.waitUntil(
      pushTaskToGcal(c.env, id, userId).catch(console.error)
    );
  }
  return c.json(task);
});

// complete / uncomplete (toggle-able via ?done=0)
//
// Recurring tasks roll forward instead of completing: on completion a task with
// a `recurrence` spec advances its due date to the next occurrence and stays
// `todo` (its subtasks reset), matching the Todoist model. `fixed` mode advances
// from the current due date; `after_completion` advances from today. The
// response carries `{ recurred, due_date }` so the client can toast it.
tasks.post("/:id/complete", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  const done = c.req.query("done") !== "0";

  if (done) {
    const t = await c.env.DB.prepare(
      "SELECT recurrence, recurrence_mode, due_date FROM tasks WHERE id = ? AND user_id = ?"
    )
      .bind(id, userId)
      .first<{
        recurrence: string | null;
        recurrence_mode: string | null;
        due_date: string | null;
      }>();

    if (t?.recurrence) {
      const anchor =
        t.recurrence_mode === "after_completion"
          ? todayStr()
          : t.due_date ?? todayStr();
      const next = nextDueDate(t.recurrence, anchor);
      if (next) {
        // Roll forward to the next occurrence AND let go of today: clear the
        // "work on it today" intent and today's time block, so ticking a
        // recurring task drops it out of Today rather than having the next
        // instance cling there. It reappears in Today on its next due day.
        await c.env.DB.prepare(
          `UPDATE tasks SET due_date = ?, status = 'todo', completed_at = NULL,
             planned_date = NULL, scheduled_start = NULL, scheduled_end = NULL,
             updated_at = ? WHERE id = ? AND user_id = ?`
        )
          .bind(next, now(), id, userId)
          .run();
        // reset checklist for the next cycle
        await c.env.DB.prepare(
          "UPDATE subtasks SET done = 0 WHERE task_id = ?"
        )
          .bind(id)
          .run();
        c.executionCtx?.waitUntil(
          pushTaskToGcal(c.env, id, userId).catch(console.error)
        );
        return c.json({ ok: true, recurred: true, due_date: next });
      }
    }
  }

  // Grab the GCal linkage before the status flips: a completed task should not
  // keep occupying the calendar. Without this, every finished task left its event
  // behind forever, which is where the stale entries came from.
  //
  // `tracker_id` comes along for the ride: ticking off a task a cadence tracker
  // emitted IS the occurrence, so the gauge must reset with it.
  const linked = await c.env.DB.prepare(
    "SELECT gcal_event_id, gcal_calendar_id, tracker_id FROM tasks WHERE id = ? AND user_id = ?"
  )
    .bind(id, userId)
    .first<{
      gcal_event_id: string | null;
      gcal_calendar_id: string | null;
      tracker_id: string | null;
    }>();

  await c.env.DB.prepare(
    `UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`
  )
    .bind(done ? "done" : "todo", done ? now() : null, now(), id, userId)
    .run();

  // Close the loop with the tracker, both ways. Without this you would tick the
  // task and then have to press Log as well, while the gauge sat there insisting
  // you had not called anyone.
  if (linked?.tracker_id) {
    if (done) {
      await logTrackerForTask(c.env.DB, userId, id, linked.tracker_id);
    } else {
      // Re-opening removes exactly the event this task created, so a Log pressed
      // by hand in between survives untouched.
      await unlogTrackerForTask(c.env.DB, userId, id);
    }
  }

  if (done && linked?.gcal_event_id) {
    // Clear the linkage too, so un-completing pushes a fresh event rather than
    // trying to PATCH one that no longer exists.
    await c.env.DB.prepare(
      "UPDATE tasks SET gcal_event_id = NULL, gcal_calendar_id = NULL WHERE id = ? AND user_id = ?"
    )
      .bind(id, userId)
      .run();
    c.executionCtx?.waitUntil(
      deleteTaskGcalEvent(
        c.env,
        linked.gcal_event_id,
        linked.gcal_calendar_id,
        userId
      ).catch(console.error)
    );
  } else if (!done) {
    // Re-opened: put it back on the calendar if it still has a date/time-block.
    c.executionCtx?.waitUntil(pushTaskToGcal(c.env, id, userId).catch(console.error));
  }
  return c.json({ ok: true, recurred: false });
});

// reschedule due date/time
tasks.post("/:id/reschedule", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  const b = await c.req.json<{ due_date: string | null; due_time?: string | null }>();
  await c.env.DB.prepare(
    "UPDATE tasks SET due_date = ?, due_time = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  )
    .bind(b.due_date, b.due_time ?? null, now(), id, userId)
    .run();
  // Move (or remove) the Google event to match. Without this the event kept the
  // OLD date, which is the other way stale entries piled up.
  c.executionCtx?.waitUntil(pushTaskToGcal(c.env, id, userId).catch(console.error));
  return c.json({ ok: true });
});

// reorder: array of {id, position, board_column?, status?}
tasks.post("/reorder", async (c) => {
  const userId = await getUserId(c);
  const items = await c.req.json<
    { id: string; position: number; board_column?: string; status?: string }[]
  >();
  const stmts = items.map((it) =>
    c.env.DB.prepare(
      "UPDATE tasks SET position = ?, board_column = COALESCE(?, board_column), status = COALESCE(?, status), updated_at = ? WHERE id = ? AND user_id = ?"
    ).bind(
      it.position,
      it.board_column ?? null,
      it.status ?? null,
      now(),
      it.id,
      userId
    )
  );
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

tasks.delete("/:id", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  // Capture GCal linkage before deletion so we can clean up the event.
  const linked = await c.env.DB.prepare(
    "SELECT gcal_event_id, gcal_calendar_id FROM tasks WHERE id = ? AND user_id = ?"
  )
    .bind(id, userId)
    .first<{ gcal_event_id: string | null; gcal_calendar_id: string | null }>();
  await c.env.DB.prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
  if (linked?.gcal_event_id) {
    c.executionCtx?.waitUntil(
      deleteTaskGcalEvent(
        c.env,
        linked.gcal_event_id,
        linked.gcal_calendar_id,
        userId
      ).catch(console.error)
    );
  }
  return c.json({ ok: true });
});

// restore a deleted task from a client-held snapshot (undo). Re-inserts the row
// with its original id, then re-attaches labels (by name) and subtasks. Ignored
// if a row with that id already exists.
tasks.post("/restore", async (c) => {
  const userId = await getUserId(c);
  const snap = await c.req.json<Record<string, unknown>>();
  const id = snap.id as string;
  if (!id) return c.json({ error: "id required" }, 400);

  const refErr = await badRefs(c.env.DB, userId, snap);
  if (refErr) {
    // area/project may have been deleted since; drop the dangling refs.
    if (refErr.startsWith("area")) snap.area_id = null;
    if (refErr.startsWith("project")) snap.project_id = null;
  }

  const cols = ["id", "user_id", ...WRITABLE.filter((f) => f in snap)];
  const vals = [id, userId, ...WRITABLE.filter((f) => f in snap).map((f) => snap[f])];
  const ph = cols.map(() => "?").join(",");
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO tasks (${cols.join(",")}) VALUES (${ph})`
  )
    .bind(...vals)
    .run();

  const labels = (snap.labels as { name: string }[] | undefined) ?? [];
  if (labels.length)
    await attachLabelNames(c.env.DB, userId, id, labels.map((l) => l.name));

  const subs = (snap.subtasks as { title: string; done?: boolean; position?: number }[] | undefined) ?? [];
  for (const s of subs) {
    await c.env.DB.prepare(
      "INSERT INTO subtasks (id, task_id, title, done, position) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(uuid(), id, s.title, s.done ? 1 : 0, s.position ?? 0)
      .run();
  }

  const row = await c.env.DB.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first();
  const [task] = await hydrateTasks(c.env.DB, [row as Record<string, unknown>]);
  return c.json(task, 201);
});

// --- snooze / defer ---
// Hide a task from the active views until `until` (YYYY-MM-DD). `until: null`
// clears the snooze and re-surfaces it immediately.
tasks.post("/:id/snooze", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  if (!(await ownsTask(c.env.DB, userId, id)))
    return c.json({ error: "not found" }, 404);
  const b = await c.req.json<{ until: string | null }>();
  await c.env.DB.prepare(
    "UPDATE tasks SET snoozed_until = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  )
    .bind(b.until ?? null, now(), id, userId)
    .run();
  return c.json({ ok: true, snoozed_until: b.until ?? null });
});

// --- time tracking ---
// Start a timer: stamp timer_started_at now (idempotent, keeps an existing start).
tasks.post("/:id/timer/start", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT timer_started_at FROM tasks WHERE id = ? AND user_id = ?"
  )
    .bind(id, userId)
    .first<{ timer_started_at: string | null }>();
  if (!row) return c.json({ error: "not found" }, 404);
  if (!row.timer_started_at) {
    await c.env.DB.prepare(
      "UPDATE tasks SET timer_started_at = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    )
      .bind(now(), now(), id, userId)
      .run();
  }
  const t = await c.env.DB.prepare(
    "SELECT * FROM tasks WHERE id = ? AND user_id = ?"
  )
    .bind(id, userId)
    .first();
  const [task] = await hydrateTasks(c.env.DB, [t as Record<string, unknown>]);
  return c.json(task);
});

// Stop a timer: fold elapsed whole minutes into time_spent_min, clear the start.
tasks.post("/:id/timer/stop", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT timer_started_at, time_spent_min FROM tasks WHERE id = ? AND user_id = ?"
  )
    .bind(id, userId)
    .first<{ timer_started_at: string | null; time_spent_min: number }>();
  if (!row) return c.json({ error: "not found" }, 404);
  if (row.timer_started_at) {
    const elapsedMs = Date.now() - new Date(row.timer_started_at).getTime();
    const mins = Math.max(0, Math.round(elapsedMs / 60000));
    await c.env.DB.prepare(
      "UPDATE tasks SET time_spent_min = time_spent_min + ?, timer_started_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?"
    )
      .bind(mins, now(), id, userId)
      .run();
  }
  const t = await c.env.DB.prepare(
    "SELECT * FROM tasks WHERE id = ? AND user_id = ?"
  )
    .bind(id, userId)
    .first();
  const [task] = await hydrateTasks(c.env.DB, [t as Record<string, unknown>]);
  return c.json(task);
});

// Set the accumulated actual directly (manual adjust from the drawer).
tasks.post("/:id/time-spent", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  if (!(await ownsTask(c.env.DB, userId, id)))
    return c.json({ error: "not found" }, 404);
  const b = await c.req.json<{ minutes: number }>();
  await c.env.DB.prepare(
    "UPDATE tasks SET time_spent_min = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  )
    .bind(Math.max(0, Math.round(b.minutes || 0)), now(), id, userId)
    .run();
  return c.json({ ok: true });
});

// --- dependencies ("blocked by") ---
// Add a blocker: `id` waits on `depends_on_id`. Rejects self-links, duplicate,
// and the immediate reverse edge (which would deadlock the pair).
tasks.post("/:id/dependencies", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  const b = await c.req.json<{ depends_on_id: string }>();
  const dep = b.depends_on_id;
  if (!dep || dep === id) return c.json({ error: "invalid dependency" }, 400);
  if (!(await ownsTask(c.env.DB, userId, id)) || !(await ownsTask(c.env.DB, userId, dep)))
    return c.json({ error: "not found" }, 404);
  const reverse = await c.env.DB.prepare(
    "SELECT 1 FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?"
  )
    .bind(dep, id)
    .first();
  if (reverse) return c.json({ error: "would create a cycle" }, 400);
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)"
  )
    .bind(id, dep)
    .run();
  return c.json({ ok: true });
});

tasks.delete("/:id/dependencies/:depId", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  if (!(await ownsTask(c.env.DB, userId, id)))
    return c.json({ error: "not found" }, 404);
  await c.env.DB.prepare(
    "DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?"
  )
    .bind(id, c.req.param("depId"))
    .run();
  return c.json({ ok: true });
});

// --- subtasks ---
//
// Subtask progress promotes the parent out of `todo`:
//
//   parent: todo ──(a subtask is ticked)──> doing ──(user completes)──> done
//              ^                              │
//              └────────── never auto ────────┘
//
// Only the todo -> doing edge is automatic. Un-ticking the last subtask does not
// demote the parent: once work has started, that is a claim about the world the
// app should not silently retract.
async function promoteParentToDoing(
  db: D1Database,
  userId: string,
  taskId: string
): Promise<void> {
  await db
    .prepare(
      "UPDATE tasks SET status = 'doing', updated_at = ? WHERE id = ? AND user_id = ? AND status = 'todo'"
    )
    .bind(now(), taskId, userId)
    .run();
}

// Every subtask mutation first verifies the parent task belongs to the user.
tasks.post("/:id/subtasks", async (c) => {
  const userId = await getUserId(c);
  const taskId = c.req.param("id");
  if (!(await ownsTask(c.env.DB, userId, taskId)))
    return c.json({ error: "not found" }, 404);
  // due_date/priority are optional: quick-capture parses "post the form fri p1"
  // client-side and sends the structured fields. Absent -> a plain subtask, as
  // before.
  const b = await c.req.json<{
    title: string;
    due_date?: string | null;
    priority?: number | null;
  }>();
  const id = uuid();
  const due_date = b.due_date ?? null;
  const priority = b.priority ?? null;
  await c.env.DB.prepare(
    "INSERT INTO subtasks (id, task_id, title, due_date, priority) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(id, taskId, b.title, due_date, priority)
    .run();
  return c.json(
    { id, task_id: taskId, title: b.title, done: false, due_date, priority },
    201
  );
});

tasks.patch("/:id/subtasks/:subId", async (c) => {
  const userId = await getUserId(c);
  const taskId = c.req.param("id");
  if (!(await ownsTask(c.env.DB, userId, taskId)))
    return c.json({ error: "not found" }, 404);
  const b = await c.req.json<{
    title?: string;
    done?: boolean;
    due_date?: string | null;
    priority?: number | null;
  }>();
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (b.title != null) {
    sets.push("title = ?");
    binds.push(b.title);
  }
  if (b.done != null) {
    sets.push("done = ?");
    binds.push(b.done ? 1 : 0);
  }
  // due_date/priority accept null to clear. `in b` (not != null) so an explicit
  // null reaches the column instead of being skipped.
  if ("due_date" in b) {
    sets.push("due_date = ?");
    binds.push(b.due_date ?? null);
  }
  if ("priority" in b) {
    sets.push("priority = ?");
    binds.push(b.priority ?? null);
  }
  if (sets.length) {
    binds.push(c.req.param("subId"), taskId);
    await c.env.DB.prepare(
      `UPDATE subtasks SET ${sets.join(", ")} WHERE id = ? AND task_id = ?`
    )
      .bind(...binds)
      .run();
  }
  if (b.done === true) await promoteParentToDoing(c.env.DB, userId, taskId);
  return c.json({ ok: true });
});

// Tick every remaining subtask at once. Backs the "complete them all" branch of
// the unfinished-subtasks warning, so finishing a parent is one round trip
// instead of one PATCH per subtask.
tasks.post("/:id/subtasks/complete-all", async (c) => {
  const userId = await getUserId(c);
  const taskId = c.req.param("id");
  if (!(await ownsTask(c.env.DB, userId, taskId)))
    return c.json({ error: "not found" }, 404);
  const res = await c.env.DB.prepare(
    "UPDATE subtasks SET done = 1 WHERE task_id = ? AND done = 0"
  )
    .bind(taskId)
    .run();
  return c.json({ ok: true, completed: res.meta.changes ?? 0 });
});

tasks.delete("/:id/subtasks/:subId", async (c) => {
  const userId = await getUserId(c);
  const taskId = c.req.param("id");
  if (!(await ownsTask(c.env.DB, userId, taskId)))
    return c.json({ error: "not found" }, 404);
  await c.env.DB.prepare("DELETE FROM subtasks WHERE id = ? AND task_id = ?")
    .bind(c.req.param("subId"), taskId)
    .run();
  return c.json({ ok: true });
});

// helper: attach label names, creating missing labels for this user
async function attachLabelNames(
  db: D1Database,
  userId: string,
  taskId: string,
  names: string[]
) {
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    let label = await db
      .prepare("SELECT id FROM labels WHERE user_id = ? AND name = ?")
      .bind(userId, name)
      .first<{ id: string }>();
    if (!label) {
      const id = uuid();
      await db
        .prepare("INSERT INTO labels (id, user_id, name) VALUES (?, ?, ?)")
        .bind(id, userId, name)
        .run();
      label = { id };
    }
    await db
      .prepare(
        "INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)"
      )
      .bind(taskId, label.id)
      .run();
  }
}
