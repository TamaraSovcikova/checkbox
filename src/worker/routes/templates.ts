import { Hono } from "hono";
import { type Bindings, getUserId, uuid } from "../db";

export const templates = new Hono<{ Bindings: Bindings }>();

type ItemInput = {
  title: string;
  notes?: string | null;
  priority?: number;
  offset_days?: number | null;
};

function addDaysStr(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Attach a template's items (ordered) to a template row shape.
async function withItems(db: D1Database, row: Record<string, unknown>) {
  const { results } = await db
    .prepare(
      "SELECT * FROM template_items WHERE template_id = ? ORDER BY position"
    )
    .bind(row.id)
    .all();
  return {
    ...row,
    items: results.map((r) => ({
      ...(r as Record<string, unknown>),
      priority: Number((r as Record<string, unknown>).priority),
      offset_days:
        (r as Record<string, unknown>).offset_days == null
          ? null
          : Number((r as Record<string, unknown>).offset_days),
      position: Number((r as Record<string, unknown>).position),
    })),
  };
}

templates.get("/", async (c) => {
  const userId = await getUserId(c);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM templates WHERE user_id = ? ORDER BY created_at"
  )
    .bind(userId)
    .all();
  const out = await Promise.all(
    (results as Record<string, unknown>[]).map((r) => withItems(c.env.DB, r))
  );
  return c.json(out);
});

templates.post("/", async (c) => {
  const userId = await getUserId(c);
  const b = await c.req.json<{
    name: string;
    icon?: string | null;
    color?: string | null;
    items?: ItemInput[];
  }>();
  if (!b.name?.trim()) return c.json({ error: "name required" }, 400);
  const id = uuid();
  await c.env.DB.prepare(
    "INSERT INTO templates (id, user_id, name, icon, color) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(id, userId, b.name.trim(), b.icon ?? null, b.color ?? null)
    .run();
  await replaceItems(c.env.DB, id, b.items ?? []);
  const row = await c.env.DB.prepare("SELECT * FROM templates WHERE id = ?")
    .bind(id)
    .first();
  return c.json(await withItems(c.env.DB, row as Record<string, unknown>), 201);
});

templates.patch("/:id", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  const owns = await c.env.DB.prepare(
    "SELECT 1 FROM templates WHERE id = ? AND user_id = ?"
  )
    .bind(id, userId)
    .first();
  if (!owns) return c.json({ error: "not found" }, 404);
  const b = await c.req.json<{
    name?: string;
    icon?: string | null;
    color?: string | null;
    items?: ItemInput[];
  }>();
  const fields = ["name", "icon", "color"].filter((f) => f in b);
  if (fields.length) {
    const set = fields.map((f) => `${f} = ?`).join(", ");
    await c.env.DB.prepare(`UPDATE templates SET ${set} WHERE id = ?`)
      .bind(...fields.map((f) => (b as Record<string, unknown>)[f]), id)
      .run();
  }
  if (Array.isArray(b.items)) await replaceItems(c.env.DB, id, b.items);
  const row = await c.env.DB.prepare("SELECT * FROM templates WHERE id = ?")
    .bind(id)
    .first();
  return c.json(await withItems(c.env.DB, row as Record<string, unknown>));
});

templates.delete("/:id", async (c) => {
  const userId = await getUserId(c);
  await c.env.DB.prepare("DELETE FROM templates WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), userId)
    .run();
  return c.json({ ok: true });
});

// Expand a template into real tasks. Due dates are anchored to `anchor`
// (default today) plus each item's offset_days. Optional area_id/project_id
// drops the whole set into a destination.
templates.post("/:id/apply", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  const b = await c.req.json<{
    anchor?: string;
    area_id?: string | null;
    project_id?: string | null;
  }>();
  const owns = await c.env.DB.prepare(
    "SELECT 1 FROM templates WHERE id = ? AND user_id = ?"
  )
    .bind(id, userId)
    .first();
  if (!owns) return c.json({ error: "not found" }, 404);

  const anchor = b.anchor ?? new Date().toISOString().slice(0, 10);
  const { results: items } = await c.env.DB.prepare(
    "SELECT * FROM template_items WHERE template_id = ? ORDER BY position"
  )
    .bind(id)
    .all<Record<string, unknown>>();

  const created: string[] = [];
  const stmts = items.map((it, i) => {
    const taskId = uuid();
    created.push(taskId);
    const offset = it.offset_days == null ? null : Number(it.offset_days);
    const due = offset == null ? null : addDaysStr(anchor, offset);
    return c.env.DB.prepare(
      `INSERT INTO tasks (id, user_id, area_id, project_id, title, notes, priority, due_date, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      taskId,
      userId,
      b.area_id ?? null,
      b.project_id ?? null,
      it.title,
      it.notes ?? null,
      Number(it.priority) || 4,
      due,
      i
    );
  });
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true, created: created.length, task_ids: created }, 201);
});

// Replace all items for a template in one batch (create + edit share this).
async function replaceItems(db: D1Database, templateId: string, items: ItemInput[]) {
  await db
    .prepare("DELETE FROM template_items WHERE template_id = ?")
    .bind(templateId)
    .run();
  const clean = items.filter((it) => it.title?.trim());
  if (!clean.length) return;
  const stmts = clean.map((it, i) =>
    db
      .prepare(
        `INSERT INTO template_items (id, template_id, title, notes, priority, offset_days, position)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        uuid(),
        templateId,
        it.title.trim(),
        it.notes ?? null,
        it.priority ?? 4,
        it.offset_days ?? null,
        i
      )
  );
  await db.batch(stmts);
}
