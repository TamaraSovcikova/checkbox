import { Hono } from "hono";
import { type Bindings, getUserId, now, rowToProject, uuid } from "../db";

export const projects = new Hono<{ Bindings: Bindings }>();

projects.get("/", async (c) => {
  const userId = await getUserId(c);
  const areaId = c.req.query("area_id");
  const status = c.req.query("status") ?? "active";
  let sql =
    "SELECT * FROM projects WHERE user_id = ? AND status = ?";
  const binds: unknown[] = [userId, status];
  if (areaId) {
    sql += " AND area_id = ?";
    binds.push(areaId);
  }
  sql += " ORDER BY position, name";
  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return c.json(results.map(rowToProject));
});

projects.post("/", async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json<{
    name: string;
    area_id?: string;
    description?: string;
    goal?: string;
    due_date?: string;
    board_columns?: string[];
  }>();
  if (!body.name?.trim()) return c.json({ error: "name required" }, 400);
  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO projects (id, user_id, area_id, name, description, goal, due_date, board_columns)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      userId,
      body.area_id ?? null,
      body.name.trim(),
      body.description ?? null,
      body.goal ?? null,
      body.due_date ?? null,
      JSON.stringify(body.board_columns ?? ["To do", "Doing", "Done"])
    )
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM projects WHERE id = ?")
    .bind(id)
    .first();
  return c.json(rowToProject(row as Record<string, unknown>), 201);
});

projects.patch("/:id", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  const body = await c.req.json<Record<string, unknown>>();
  if ("board_columns" in body && Array.isArray(body.board_columns))
    body.board_columns = JSON.stringify(body.board_columns);
  const allowed = [
    "name",
    "area_id",
    "description",
    "goal",
    "status",
    "start_date",
    "due_date",
    "board_columns",
    "position",
  ].filter((f) => f in body);
  if (allowed.length === 0) return c.json({ error: "no fields" }, 400);
  const set = allowed.map((f) => `${f} = ?`).join(", ");
  await c.env.DB.prepare(
    `UPDATE projects SET ${set}, updated_at = ? WHERE id = ? AND user_id = ?`
  )
    .bind(...allowed.map((f) => body[f]), now(), id, userId)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM projects WHERE id = ?")
    .bind(id)
    .first();
  return c.json(rowToProject(row as Record<string, unknown>));
});

projects.post("/:id/complete", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  await c.env.DB.prepare(
    "UPDATE projects SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  )
    .bind(now(), now(), id, userId)
    .run();
  return c.json({ ok: true });
});

projects.delete("/:id", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
  return c.json({ ok: true });
});
