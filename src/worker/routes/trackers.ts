import { Hono } from "hono";
import { type Bindings, getUserId, uuid, now } from "../db";

export const trackers = new Hono<{ Bindings: Bindings }>();

type TrackerRow = {
  id: string;
  user_id: string;
  name: string;
  kind: string;
  target_days: number | null;
  area_id: string | null;
  notes: string | null;
  archived: number;
  auto_task: number;
  task_title: string | null;
  position: number;
  created_at: string;
  last_at: string | null;
  event_count: number;
};

const shape = (r: TrackerRow) => ({
  ...r,
  archived: r.archived === 1,
  auto_task: r.auto_task === 1,
  event_count: r.event_count ?? 0,
});

// Every read joins the event log for the two derived fields the UI actually
// draws (last occurrence, how many). Done in SQL so a page of trackers is one
// round trip rather than one query per row, and so the client never has to pull
// a whole history to render a single number.
const SELECT_WITH_DERIVED = `
  SELECT t.*,
         (SELECT MAX(e.occurred_at) FROM tracker_events e WHERE e.tracker_id = t.id) AS last_at,
         (SELECT COUNT(*)           FROM tracker_events e WHERE e.tracker_id = t.id) AS event_count
    FROM trackers t
   WHERE t.user_id = ?`;

trackers.get("/", async (c) => {
  const userId = await getUserId(c);
  // Archived are excluded by default: the page is a working gauge, not an
  // archive. ?archived=1 shows them for un-archiving.
  const wantArchived = c.req.query("archived") === "1";
  const { results } = await c.env.DB.prepare(
    `${SELECT_WITH_DERIVED} AND t.archived = ? ORDER BY t.position, t.created_at`
  )
    .bind(userId, wantArchived ? 1 : 0)
    .all<TrackerRow>();
  return c.json((results ?? []).map(shape));
});

trackers.post("/", async (c) => {
  const userId = await getUserId(c);
  const b = await c.req.json<Record<string, unknown>>();
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return c.json({ error: "name required" }, 400);

  // A target of 0 or a negative is meaningless (it would read as permanently
  // overdue), so treat anything not a positive number as "no target".
  const target =
    typeof b.target_days === "number" && b.target_days > 0
      ? Math.round(b.target_days)
      : null;

  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO trackers (id, user_id, name, kind, target_days, area_id, notes, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(position) + 1 FROM trackers WHERE user_id = ?), 0), ?)`
  )
    .bind(
      id,
      userId,
      name,
      typeof b.kind === "string" && b.kind ? b.kind : "contact",
      target,
      typeof b.area_id === "string" && b.area_id ? b.area_id : null,
      typeof b.notes === "string" ? b.notes : null,
      userId,
      now()
    )
    .run();

  // Optionally seed the log, so "I last called her on Tuesday" can be recorded
  // at creation instead of forcing a fake entry for today.
  if (typeof b.last_at === "string" && b.last_at) {
    await c.env.DB.prepare(
      "INSERT INTO tracker_events (id, user_id, tracker_id, occurred_at) VALUES (?, ?, ?, ?)"
    )
      .bind(uuid(), userId, id, b.last_at)
      .run();
  }

  const row = await c.env.DB.prepare(`${SELECT_WITH_DERIVED} AND t.id = ?`)
    .bind(userId, id)
    .first<TrackerRow>();
  return c.json(shape(row as TrackerRow), 201);
});

const WRITABLE = [
  "name",
  "kind",
  "section",
  "target_days",
  "area_id",
  "notes",
  "archived",
  "auto_task",
  "task_title",
  "position",
];

trackers.patch("/:id", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  const b = await c.req.json<Record<string, unknown>>();
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const f of WRITABLE) {
    if (!(f in b)) continue;
    let v = b[f];
    if (f === "archived" || f === "auto_task") v = v ? 1 : 0;
    // Same rule as create: only a positive number is a target.
    if (f === "target_days") v = typeof v === "number" && v > 0 ? Math.round(v) : null;
    sets.push(`${f} = ?`);
    binds.push(v ?? null);
  }
  if (sets.length) {
    binds.push(id, userId);
    await c.env.DB.prepare(
      `UPDATE trackers SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`
    )
      .bind(...binds)
      .run();
  }
  const row = await c.env.DB.prepare(`${SELECT_WITH_DERIVED} AND t.id = ?`)
    .bind(userId, id)
    .first<TrackerRow>();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(shape(row));
});

trackers.delete("/:id", async (c) => {
  const userId = await getUserId(c);
  // tracker_events cascade on the FK, so the log goes with it.
  await c.env.DB.prepare("DELETE FROM trackers WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), userId)
    .run();
  return c.body(null, 204);
});

// Log an occurrence: the button that resets the counter to zero.
trackers.post("/:id/log", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  // Ownership is checked explicitly rather than trusted from the path, so a
  // known id from another account cannot have events appended to it.
  const owns = await c.env.DB.prepare(
    "SELECT 1 FROM trackers WHERE id = ? AND user_id = ?"
  )
    .bind(id, userId)
    .first();
  if (!owns) return c.json({ error: "not found" }, 404);

  // A bare log (no body at all) is the common case, so an unparseable/absent
  // body must mean "now", not a 400.
  const b = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);
  const occurredAt =
    typeof b.occurred_at === "string" && b.occurred_at ? b.occurred_at : now();
  const eventId = uuid();
  await c.env.DB.prepare(
    "INSERT INTO tracker_events (id, user_id, tracker_id, occurred_at, note) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(
      eventId,
      userId,
      id,
      occurredAt,
      typeof b.note === "string" && b.note ? b.note : null
    )
    .run();

  const row = await c.env.DB.prepare(`${SELECT_WITH_DERIVED} AND t.id = ?`)
    .bind(userId, id)
    .first<TrackerRow>();
  // The event id comes back so the client can undo exactly the row it just
  // wrote, rather than deleting "the latest" and racing another log.
  return c.json({ tracker: shape(row as TrackerRow), event_id: eventId }, 201);
});

// Undo a specific log entry (powers the toast's Undo).
trackers.delete("/:id/log/:eventId", async (c) => {
  const userId = await getUserId(c);
  await c.env.DB.prepare(
    "DELETE FROM tracker_events WHERE id = ? AND tracker_id = ? AND user_id = ?"
  )
    .bind(c.req.param("eventId"), c.req.param("id"), userId)
    .run();
  const row = await c.env.DB.prepare(`${SELECT_WITH_DERIVED} AND t.id = ?`)
    .bind(userId, c.req.param("id"))
    .first<TrackerRow>();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(shape(row));
});

// The log itself, newest first: the history behind a row.
trackers.get("/:id/events", async (c) => {
  const userId = await getUserId(c);
  const { results } = await c.env.DB.prepare(
    `SELECT id, tracker_id, occurred_at, note FROM tracker_events
      WHERE tracker_id = ? AND user_id = ? ORDER BY occurred_at DESC LIMIT 100`
  )
    .bind(c.req.param("id"), userId)
    .all();
  return c.json(results ?? []);
});
