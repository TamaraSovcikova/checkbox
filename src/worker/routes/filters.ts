import { Hono } from "hono";
import { type Bindings, getUserId, uuid } from "../db";
import { hydrateTasks } from "./_hydrate";

export const filters = new Hono<{ Bindings: Bindings }>();

// A saved filter's query is a small JSON object. Every field is optional and
// ANDed together:
//   text        substring match on title/notes
//   priority_max 1..4: tasks at or above this priority (<=)
//   label       label name
//   area_id / project_id
//   due         overdue | today | week | none | any
//   planned     same vocabulary, over planned_date (the day I mean to work on it)
//   <col>_from / <col>_to
//               inclusive bounds, read only when that column's mode is "range"
//   dates       all | any: how the two DATE conditions combine with EACH OTHER.
//               Everything else in the query stays ANDed.
//   status      open | done | any   (default open)
//   whenever / optional / recurring / blocked
//               any | yes | no
type DateFilter =
  | "any"
  | "overdue"
  | "today"
  | "week"
  | "month"
  | "range"
  | "none";
type TriState = "any" | "yes" | "no";

type FilterQuery = {
  text?: string;
  priority_max?: number;
  label?: string;
  area_id?: string;
  project_id?: string;
  due?: DateFilter;
  due_from?: string;
  due_to?: string;
  planned?: DateFilter;
  planned_from?: string;
  planned_to?: string;
  dates?: "all" | "any";
  status?: "open" | "done" | "any";
  whenever?: TriState;
  optional?: TriState;
  recurring?: TriState;
  blocked?: TriState;
  parked?: TriState;
};

function todayStr(tz = "Europe/Brussels") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysStr(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  const p = (x: number) => String(x).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

function rowToFilter(r: Record<string, unknown>) {
  let query: FilterQuery = {};
  try {
    query = JSON.parse((r.query as string) ?? "{}");
  } catch {
    /* keep empty */
  }
  return { id: r.id, name: r.name, query, position: Number(r.position) };
}

filters.get("/", async (c) => {
  const userId = await getUserId(c);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM saved_filters WHERE user_id = ? ORDER BY position, name"
  )
    .bind(userId)
    .all();
  return c.json((results as Record<string, unknown>[]).map(rowToFilter));
});

filters.post("/", async (c) => {
  const userId = await getUserId(c);
  const b = await c.req.json<{ name: string; query: FilterQuery }>();
  if (!b.name?.trim()) return c.json({ error: "name required" }, 400);
  const id = uuid();
  await c.env.DB.prepare(
    "INSERT INTO saved_filters (id, user_id, name, query, position) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position)+1,0) FROM saved_filters WHERE user_id = ?))"
  )
    .bind(id, userId, b.name.trim(), JSON.stringify(b.query ?? {}), userId)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM saved_filters WHERE id = ?")
    .bind(id)
    .first();
  return c.json(rowToFilter(row as Record<string, unknown>), 201);
});

// Persist a new order for the sidebar's saved filters. Same shape as
// /projects/reorder: one round trip for the whole list, every row scoped to the
// user so a foreign id in the payload updates nothing. Registered BEFORE /:id so
// "reorder" is not read as a filter id.
filters.post("/reorder", async (c) => {
  const userId = await getUserId(c);
  const items = await c.req.json<{ id: string; position: number }[]>();
  const stmts = (Array.isArray(items) ? items : []).map((it) =>
    c.env.DB.prepare(
      "UPDATE saved_filters SET position = ? WHERE id = ? AND user_id = ?"
    ).bind(it.position, it.id, userId)
  );
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

filters.patch("/:id", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  const b = await c.req.json<{ name?: string; query?: FilterQuery }>();
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (b.name != null) {
    sets.push("name = ?");
    binds.push(b.name.trim());
  }
  if (b.query != null) {
    sets.push("query = ?");
    binds.push(JSON.stringify(b.query));
  }
  if (sets.length) {
    binds.push(id, userId);
    await c.env.DB.prepare(
      `UPDATE saved_filters SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`
    )
      .bind(...binds)
      .run();
  }
  return c.json({ ok: true });
});

filters.delete("/:id", async (c) => {
  const userId = await getUserId(c);
  await c.env.DB.prepare("DELETE FROM saved_filters WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), userId)
    .run();
  return c.json({ ok: true });
});

// Execute a saved filter and return its matching tasks.
filters.get("/:id/tasks", async (c) => {
  const userId = await getUserId(c);
  const row = await c.env.DB.prepare(
    "SELECT * FROM saved_filters WHERE id = ? AND user_id = ?"
  )
    .bind(c.req.param("id"), userId)
    .first();
  if (!row) return c.json({ error: "not found" }, 404);
  const { query } = rowToFilter(row as Record<string, unknown>);

  let sql = "SELECT t.* FROM tasks t";
  const binds: unknown[] = [userId];
  const where = ["t.user_id = ?", "t.parent_task_id IS NULL"];

  if (query.label) {
    sql +=
      " JOIN task_labels tl ON tl.task_id = t.id JOIN labels l ON l.id = tl.label_id";
    where.push("l.name = ? AND l.user_id = ?");
    binds.push(query.label, userId);
  }

  const status = query.status ?? "open";
  if (status === "open") where.push("t.status != 'done'");
  else if (status === "done") where.push("t.status = 'done'");

  if (query.text) {
    where.push("(t.title LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\')");
    const like = `%${query.text.replace(/[%_]/g, (m) => "\\" + m)}%`;
    binds.push(like, like);
  }
  if (query.priority_max) {
    where.push("t.priority <= ?");
    binds.push(query.priority_max);
  }
  if (query.area_id) {
    where.push("t.area_id = ?");
    binds.push(query.area_id);
  }
  if (query.project_id) {
    where.push("t.project_id = ?");
    binds.push(query.project_id);
  }
  const today = todayStr();

  // One clause builder for BOTH date columns, so "due this week" and "planned
  // this week" can never drift into meaning different spans of days.
  // Builds ONE self-contained clause per date column, rather than pushing
  // straight into `where`. That is what lets the two be combined with OR: an
  // OR-ed group has to be parenthesised as a unit, and clauses scattered into a
  // flat AND list cannot be.
  const dateClause = (
    col: string,
    mode: DateFilter | undefined,
    from?: string,
    to?: string
  ): { sql: string; binds: unknown[] } | null => {
    if (!mode || mode === "any") return null;
    if (mode === "none") return { sql: `t.${col} IS NULL`, binds: [] };
    if (mode === "overdue")
      // Strictly before today, and NOT-NULL is implicit in SQL comparison, which
      // is what we want: an undated task is not late, it is undated.
      return { sql: `t.${col} < ?`, binds: [today] };
    if (mode === "today") return { sql: `t.${col} = ?`, binds: [today] };
    if (mode === "week" || mode === "month")
      // Both are ROLLING windows from today, not calendar weeks or months. A
      // saved filter is read on an arbitrary day, and "the next 30 days" answers
      // the same question every time you open it, while "September" stops being
      // the question the moment September ends.
      return {
        sql: `(t.${col} >= ? AND t.${col} <= ?)`,
        binds: [today, addDaysStr(today, mode === "week" ? 7 : 30)],
      };
    // range: inclusive, each end independently optional. Neither given means
    // "has a date at all", the literal reading of an unbounded range.
    const parts = [`t.${col} IS NOT NULL`];
    const b: unknown[] = [];
    if (from) {
      parts.push(`t.${col} >= ?`);
      b.push(from);
    }
    if (to) {
      parts.push(`t.${col} <= ?`);
      b.push(to);
    }
    return { sql: `(${parts.join(" AND ")})`, binds: b };
  };

  const dateParts = [
    dateClause("due_date", query.due, query.due_from, query.due_to),
    dateClause("planned_date", query.planned, query.planned_from, query.planned_to),
  ].filter((x): x is { sql: string; binds: unknown[] } => x !== null);

  if (dateParts.length) {
    // OR only means something with two sides. With one date condition the join
    // is irrelevant, and "any" must not be allowed to read as "ignore this".
    const join = query.dates === "any" && dateParts.length > 1 ? " OR " : " AND ";
    where.push(`(${dateParts.map((p) => p.sql).join(join)})`);
    binds.push(...dateParts.flatMap((p) => p.binds));
  }


  // 0/1 columns. `yes` and `no` are both real answers; absent means "do not ask".
  const flagWhere = (col: string, mode: TriState | undefined) => {
    if (!mode || mode === "any") return;
    where.push(`t.${col} = ?`);
    binds.push(mode === "yes" ? 1 : 0);
  };
  flagWhere("whenever", query.whenever);
  flagWhere("optional", query.optional);

  // Parked defaults to EXCLUDED rather than to "any", unlike every other filter
  // field. A saved filter is a working list, and parking exists to keep set-aside
  // work out of those; a filter that quietly included it would undo the feature.
  // Asking explicitly still reaches them.
  if (query.parked === "yes") where.push("t.parked_at IS NOT NULL");
  else if (query.parked !== "any") where.push("t.parked_at IS NULL");

  // Recurring is not a flag column: it is "has a recurrence rule". Empty string
  // counts as none, because that is how the sheet clears it.
  if (query.recurring && query.recurring !== "any") {
    where.push(
      query.recurring === "yes"
        ? "(t.recurrence IS NOT NULL AND t.recurrence != '')"
        : "(t.recurrence IS NULL OR t.recurrence = '')"
    );
  }

  // Blocked, defined exactly as the rest of the app defines it (see
  // client/lib/blocked isBlocked): an OPEN task blocker, or a blocked-until date
  // still in the future. Kept in one expression so `no` is the true negation of
  // `yes` rather than a second, subtly different rule.
  if (query.blocked && query.blocked !== "any") {
    const isBlocked = `(EXISTS (SELECT 1 FROM task_dependencies d
                                  JOIN tasks b ON b.id = d.depends_on_id
                                 WHERE d.task_id = t.id AND b.status != 'done')
                        OR (t.blocked_until IS NOT NULL AND t.blocked_until > ?))`;
    where.push(query.blocked === "yes" ? isBlocked : `NOT ${isBlocked}`);
    binds.push(today);
  }

  sql += ` WHERE ${where.join(" AND ")} ORDER BY t.priority, t.due_date IS NULL, t.due_date, t.position`;
  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return c.json(await hydrateTasks(c.env.DB, results as Record<string, unknown>[]));
});
