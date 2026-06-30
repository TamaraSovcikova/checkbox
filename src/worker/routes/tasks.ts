import { Hono } from "hono";
import { type Bindings, getUserId, now, uuid } from "../db";
import { hydrateTasks } from "./_hydrate";

export const tasks = new Hono<{ Bindings: Bindings }>();

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
];

// LIST with filters: ?project_id= &area_id= &status= &backlog=1
tasks.get("/", async (c) => {
  const userId = await getUserId(c);
  const q = c.req.query();
  let sql = "SELECT * FROM tasks WHERE user_id = ? AND parent_task_id IS NULL";
  const binds: unknown[] = [userId];
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
  } else {
    sql += " AND status != 'done'";
  }
  sql += " ORDER BY position, priority, created_at";
  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds)
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
  return c.json(task, 201);
});

tasks.patch("/:id", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  const b = await c.req.json<Record<string, unknown>>();
  const fields = WRITABLE.filter((f) => f in b);
  if (fields.length) {
    const set = fields.map((f) => `${f} = ?`).join(", ");
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
  const row = await c.env.DB.prepare("SELECT * FROM tasks WHERE id = ?")
    .bind(id)
    .first();
  const [task] = await hydrateTasks(c.env.DB, [row as Record<string, unknown>]);
  return c.json(task);
});

// complete / uncomplete (toggle-able via ?done=0)
tasks.post("/:id/complete", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  const done = c.req.query("done") !== "0";
  await c.env.DB.prepare(
    `UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`
  )
    .bind(done ? "done" : "todo", done ? now() : null, now(), id, userId)
    .run();
  return c.json({ ok: true });
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
  await c.env.DB.prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), userId)
    .run();
  return c.json({ ok: true });
});

// --- subtasks ---
tasks.post("/:id/subtasks", async (c) => {
  const taskId = c.req.param("id");
  const b = await c.req.json<{ title: string }>();
  const id = uuid();
  await c.env.DB.prepare(
    "INSERT INTO subtasks (id, task_id, title) VALUES (?, ?, ?)"
  )
    .bind(id, taskId, b.title)
    .run();
  return c.json({ id, task_id: taskId, title: b.title, done: false }, 201);
});

tasks.patch("/:id/subtasks/:subId", async (c) => {
  const b = await c.req.json<{ title?: string; done?: boolean }>();
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
  if (sets.length) {
    binds.push(c.req.param("subId"));
    await c.env.DB.prepare(`UPDATE subtasks SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...binds)
      .run();
  }
  return c.json({ ok: true });
});

tasks.delete("/:id/subtasks/:subId", async (c) => {
  await c.env.DB.prepare("DELETE FROM subtasks WHERE id = ?")
    .bind(c.req.param("subId"))
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
