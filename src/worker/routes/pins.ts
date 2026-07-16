import { Hono } from "hono";
import { type Bindings, getUserId, uuid, now } from "../db";

export const pins = new Hono<{ Bindings: Bindings }>();

type PinRow = {
  id: string;
  user_id: string;
  kind: string;
  title: string | null;
  body: string | null;
  items: string | null;
  pinned_today: number;
  placement: string;
  color: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

// Parse the JSON items blob back into an array for the client.
function hydrate(r: PinRow) {
  let items: unknown = [];
  if (r.items) {
    try {
      items = JSON.parse(r.items);
    } catch {
      items = [];
    }
  }
  return { ...r, items: Array.isArray(items) ? items : [] };
}

pins.get("/", async (c) => {
  const userId = await getUserId(c);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM pins WHERE user_id = ? ORDER BY position, created_at"
  )
    .bind(userId)
    .all<PinRow>();
  return c.json((results as PinRow[]).map(hydrate));
});

pins.post("/", async (c) => {
  const userId = await getUserId(c);
  const b = await c.req.json<{
    kind?: "note" | "list";
    title?: string | null;
    body?: string | null;
    items?: unknown[];
    placement?: string;
    color?: string | null;
    scope?: string;
  }>();
  const id = uuid();
  // New pins go to the top (lowest position).
  const min = await c.env.DB.prepare(
    "SELECT MIN(position) AS m FROM pins WHERE user_id = ?"
  )
    .bind(userId)
    .first<{ m: number | null }>();
  const position = (min?.m ?? 0) - 1;
  const placement =
    b.placement === "top" || b.placement === "side" ? b.placement : "unpinned";
  await c.env.DB.prepare(
    `INSERT INTO pins (id, user_id, kind, title, body, items, placement, color, pinned_today, position, scope)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      userId,
      b.kind === "list" ? "list" : "note",
      b.title ?? null,
      b.body ?? null,
      b.items ? JSON.stringify(b.items) : null,
      placement,
      b.color ?? null,
      placement === "top" ? 1 : 0,
      position,
      // Created from whichever page you were on; Today when unspecified.
      typeof b.scope === "string" && b.scope ? b.scope : "today"
    )
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM pins WHERE id = ?")
    .bind(id)
    .first<PinRow>();
  return c.json(hydrate(row as PinRow), 201);
});

const WRITABLE = [
  "kind",
  "title",
  "body",
  "placement",
  "color",
  "position",
  "scope",
] as const;

pins.patch("/:id", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  const owns = await c.env.DB.prepare(
    "SELECT 1 FROM pins WHERE id = ? AND user_id = ?"
  )
    .bind(id, userId)
    .first();
  if (!owns) return c.json({ error: "not found" }, 404);

  const b = await c.req.json<Record<string, unknown>>();
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const f of WRITABLE) {
    if (f in b) {
      sets.push(`${f} = ?`);
      binds.push(b[f]);
    }
  }
  // Keep the legacy pinned_today boolean in step with placement.
  if ("placement" in b) {
    sets.push("pinned_today = ?");
    binds.push(b.placement === "top" ? 1 : 0);
  }
  // items is stored as JSON text.
  if ("items" in b) {
    sets.push("items = ?");
    binds.push(Array.isArray(b.items) ? JSON.stringify(b.items) : null);
  }
  if (sets.length) {
    sets.push("updated_at = ?");
    binds.push(now(), id, userId);
    await c.env.DB.prepare(
      `UPDATE pins SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`
    )
      .bind(...binds)
      .run();
  }
  const row = await c.env.DB.prepare(
    "SELECT * FROM pins WHERE id = ? AND user_id = ?"
  )
    .bind(id, userId)
    .first<PinRow>();
  return c.json(hydrate(row as PinRow));
});

pins.delete("/:id", async (c) => {
  const userId = await getUserId(c);
  await c.env.DB.prepare("DELETE FROM pins WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), userId)
    .run();
  return c.json({ ok: true });
});
