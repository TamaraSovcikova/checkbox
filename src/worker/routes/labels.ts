import { Hono } from "hono";
import { type Bindings, getUserId, uuid } from "../db";

export const labels = new Hono<{ Bindings: Bindings }>();

labels.get("/", async (c) => {
  const userId = await getUserId(c);
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, color FROM labels WHERE user_id = ? ORDER BY name"
  )
    .bind(userId)
    .all();
  return c.json(results);
});

labels.post("/", async (c) => {
  const userId = await getUserId(c);
  const b = await c.req.json<{ name: string; color?: string }>();
  if (!b.name?.trim()) return c.json({ error: "name required" }, 400);
  const id = uuid();
  await c.env.DB.prepare(
    "INSERT INTO labels (id, user_id, name, color) VALUES (?, ?, ?, ?)"
  )
    .bind(id, userId, b.name.trim(), b.color ?? null)
    .run();
  return c.json({ id, name: b.name.trim(), color: b.color ?? null }, 201);
});

labels.patch("/:id", async (c) => {
  const userId = await getUserId(c);
  const b = await c.req.json<{ name?: string; color?: string }>();
  const fields = ["name", "color"].filter((f) => f in b) as ("name" | "color")[];
  if (!fields.length) return c.json({ error: "no fields" }, 400);
  const set = fields.map((f) => `${f} = ?`).join(", ");
  await c.env.DB.prepare(
    `UPDATE labels SET ${set} WHERE id = ? AND user_id = ?`
  )
    .bind(...fields.map((f) => b[f]), c.req.param("id"), userId)
    .run();
  return c.json({ ok: true });
});

labels.delete("/:id", async (c) => {
  const userId = await getUserId(c);
  await c.env.DB.prepare("DELETE FROM labels WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), userId)
    .run();
  return c.json({ ok: true });
});
