import { Hono } from "hono";
import { type Bindings, getUserId, now, uuid } from "../db";

export const areas = new Hono<{ Bindings: Bindings }>();

areas.get("/", async (c) => {
  const userId = await getUserId(c);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM areas WHERE user_id = ? AND archived_at IS NULL ORDER BY position, name"
  )
    .bind(userId)
    .all();
  return c.json(results);
});

areas.post("/", async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json<{
    name: string;
    color?: string;
    icon?: string;
  }>();
  if (!body.name?.trim()) return c.json({ error: "name required" }, 400);
  const id = uuid();
  await c.env.DB.prepare(
    "INSERT INTO areas (id, user_id, name, color, icon) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(id, userId, body.name.trim(), body.color ?? null, body.icon ?? null)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM areas WHERE id = ?")
    .bind(id)
    .first();
  return c.json(row, 201);
});

areas.patch("/:id", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  const body = await c.req.json<Record<string, unknown>>();
  const fields = ["name", "color", "icon", "position", "archived_at"].filter(
    (f) => f in body
  );
  if (fields.length === 0) return c.json({ error: "no fields" }, 400);
  const set = fields.map((f) => `${f} = ?`).join(", ");
  await c.env.DB.prepare(
    `UPDATE areas SET ${set}, updated_at = ? WHERE id = ? AND user_id = ?`
  )
    .bind(...fields.map((f) => body[f]), now(), id, userId)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM areas WHERE id = ?")
    .bind(id)
    .first();
  return c.json(row);
});

areas.delete("/:id", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM areas WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
  return c.json({ ok: true });
});
