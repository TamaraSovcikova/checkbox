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
//   status      open | done | any   (default open)
//   whenever / optional / recurring / blocked
//               any | yes | no
type DateFilter = "any" | "overdue" | "today" | "week" | "none";
type TriState = "any" | "yes" | "no";

type FilterQuery = {
  text?: string;
  priority_max?: number;
  label?: string;
  area_id?: string;
  project_id?: string;
  due?: DateFilter;
  planned?: DateFilter;
  status?: "open" | "done" | "any";
  whenever?: TriState;
  optional?: TriState;
  recurring?: TriState;
  blocked?: TriState;
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
  const dateWhere = (col: string, mode: DateFilter | undefined) => {
    if (!mode || mode === "any") return;
    if (mode === "none") {
      where.push(`t.${col} IS NULL`);
    } else if (mode === "overdue") {
      // Strictly before today, and NOT-NULL is implicit in SQL comparison, which
      // is what we want: an undated task is not late, it is undated.
      where.push(`t.${col} < ?`);
      binds.push(today);
    } else if (mode === "today") {
      where.push(`t.${col} = ?`);
      binds.push(today);
    } else if (mode === "week") {
      where.push(`t.${col} >= ? AND t.${col} <= ?`);
      binds.push(today, addDaysStr(today, 7));
    }
  };
  dateWhere("due_date", query.due);
  dateWhere("planned_date", query.planned);

  // 0/1 columns. `yes` and `no` are both real answers; absent means "do not ask".
  const flagWhere = (col: string, mode: TriState | undefined) => {
    if (!mode || mode === "any") return;
    where.push(`t.${col} = ?`);
    binds.push(mode === "yes" ? 1 : 0);
  };
  flagWhere("whenever", query.whenever);
  flagWhere("optional", query.optional);

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
