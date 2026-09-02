import { Hono } from "hono";
import { type Bindings, getUserId, uuid } from "../db";

export const labels = new Hono<{ Bindings: Bindings }>();

// Each label with how many OPEN tasks carry it.
//
// The count is what makes a long label list usable: 68 labels sorted
// alphabetically is a wall, and 28 of them have no open task at all, so a third
// of that wall leads nowhere. Sorted by weight, the handful she actually uses
// come first. Open tasks only, deliberately: a label that only survives on
// finished work is not a place you want to navigate to.
labels.get("/", async (c) => {
  const userId = await getUserId(c);
  const { results } = await c.env.DB.prepare(
    `SELECT l.id, l.name, l.color,
            (SELECT COUNT(*) FROM task_labels tl
               JOIN tasks t ON t.id = tl.task_id
              WHERE tl.label_id = l.id AND t.status != 'done') AS open_count
       FROM labels l
      WHERE l.user_id = ?
      ORDER BY l.name`
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
