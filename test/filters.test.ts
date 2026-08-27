// What a saved filter can actually ask for.
//
// Her report: "I want to filter by the planned date field and I can't". True,
// and it was not the only gap: planned_date only became a field you can SET in
// chat #59, and `whenever`, `optional`, `recurring` and `blocked` were all flags
// you could set and then had no way to find by, which is half a feature.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { filters } from "../src/worker/routes/filters";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const TOKEN = "tok-a";

const brussels = (offsetDays = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
};
const TODAY = brussels(0);
const YESTERDAY = brussels(-1);
const IN_3 = brussels(3);
const NEXT_MONTH = brussels(30);

let raw: Db;
let d1: TestD1;
let app: Hono<any>;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN}', '${USER}');
  `);
  app = new Hono();
  app.route("/", filters);
});

function task(
  id: string,
  over: {
    due?: string | null;
    planned?: string | null;
    whenever?: number;
    optional?: number;
    recurrence?: string | null;
    blockedUntil?: string | null;
    status?: string;
  } = {}
) {
  raw
    .prepare(
      `INSERT INTO tasks (id, user_id, title, status, due_date, planned_date, whenever, optional, recurrence, blocked_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      USER,
      id,
      over.status ?? "todo",
      over.due ?? null,
      over.planned ?? null,
      over.whenever ?? 0,
      over.optional ?? 0,
      over.recurrence ?? null,
      over.blockedUntil ?? null
    );
}

const blocks = (blocker: string, waiter: string) =>
  raw
    .prepare("INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)")
    .run(waiter, blocker);

// Save a filter, run it, return the matching ids.
async function run(query: Record<string, unknown>): Promise<string[]> {
  raw
    .prepare(
      "INSERT OR REPLACE INTO saved_filters (id, user_id, name, query, position) VALUES ('f1', ?, 'f', ?, 0)"
    )
    .run(USER, JSON.stringify(query));
  const res = await app.request(
    "/f1/tasks",
    { headers: { Authorization: `Bearer ${TOKEN}` } },
    { DB: d1 } as any
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as any[]).map((t) => t.id).sort();
}

describe("filter by PLANNED date, her ask", () => {
  beforeEach(() => {
    task("planned-today", { planned: TODAY });
    task("carried", { planned: YESTERDAY });
    task("planned-soon", { planned: IN_3 });
    task("planned-far", { planned: NEXT_MONTH });
    task("unplanned");
  });

  it("finds what is planned for today", () =>
    expect(run({ planned: "today" })).resolves.toEqual(["planned-today"]));

  it("finds a plan you did not get to, without calling it overdue", () =>
    expect(run({ planned: "overdue" })).resolves.toEqual(["carried"]));

  it("finds the coming week, today included", () =>
    expect(run({ planned: "week" })).resolves.toEqual([
      "planned-soon",
      "planned-today",
    ]));

  it("finds what has no plan at all", () =>
    expect(run({ planned: "none" })).resolves.toEqual(["unplanned"]));

  it("ignores the field entirely when it is not asked about", () =>
    expect(run({})).resolves.toHaveLength(5));

  it("does not confuse a plan with a deadline", async () => {
    task("due-today", { due: TODAY });
    await expect(run({ planned: "today" })).resolves.toEqual(["planned-today"]);
    await expect(run({ due: "today" })).resolves.toEqual(["due-today"]);
  });

  it("ANDs with the due date rather than replacing it", async () => {
    task("both", { due: TODAY, planned: TODAY });
    await expect(run({ due: "today", planned: "today" })).resolves.toEqual(["both"]);
  });
});

describe("filter by what KIND of task it is", () => {
  it("finds, and excludes, whenever tasks", async () => {
    task("someday", { whenever: 1 });
    task("ordinary");
    await expect(run({ whenever: "yes" })).resolves.toEqual(["someday"]);
    await expect(run({ whenever: "no" })).resolves.toEqual(["ordinary"]);
    await expect(run({ whenever: "any" })).resolves.toHaveLength(2);
  });

  it("finds, and excludes, optional tasks", async () => {
    task("nice", { optional: 1 });
    task("committed");
    await expect(run({ optional: "yes" })).resolves.toEqual(["nice"]);
    await expect(run({ optional: "no" })).resolves.toEqual(["committed"]);
  });

  it("treats an empty recurrence string as not repeating, like the sheet does", async () => {
    task("weekly", { recurrence: "weekly" });
    task("cleared", { recurrence: "" });
    task("plain");
    await expect(run({ recurring: "yes" })).resolves.toEqual(["weekly"]);
    await expect(run({ recurring: "no" })).resolves.toEqual(["cleared", "plain"]);
  });
});

describe("filter by blocked, as the rest of the app defines it", () => {
  it("counts an open task blocker", async () => {
    task("blocker");
    task("waiter");
    blocks("blocker", "waiter");
    await expect(run({ blocked: "yes" })).resolves.toEqual(["waiter"]);
  });

  it("stops counting it once the blocker is done", async () => {
    task("blocker", { status: "done" });
    task("waiter");
    blocks("blocker", "waiter");
    await expect(run({ blocked: "yes" })).resolves.toEqual([]);
    await expect(run({ blocked: "no" })).resolves.toEqual(["waiter"]);
  });

  it("counts a blocked-until date in the future, but not one in the past", async () => {
    task("waiting", { blockedUntil: NEXT_MONTH });
    task("freed", { blockedUntil: YESTERDAY });
    await expect(run({ blocked: "yes" })).resolves.toEqual(["waiting"]);
    await expect(run({ blocked: "no" })).resolves.toEqual(["freed"]);
  });

  it("`no` is the exact negation of `yes`, never a second slightly different rule", async () => {
    task("a");
    task("b", { blockedUntil: NEXT_MONTH });
    task("c");
    blocks("a", "c");
    const yes = await run({ blocked: "yes" });
    const no = await run({ blocked: "no" });
    expect([...yes, ...no].sort()).toEqual(["a", "b", "c"]);
    expect(yes.filter((x) => no.includes(x))).toEqual([]);
  });
});

describe("the old filters still work beside the new ones", () => {
  it("ANDs everything together", async () => {
    task("hit", { planned: TODAY, optional: 0 });
    task("wrong-plan", { planned: NEXT_MONTH });
    task("wrong-flag", { planned: TODAY, optional: 1 });
    await expect(run({ planned: "today", optional: "no" })).resolves.toEqual(["hit"]);
  });

  it("still defaults to open tasks only", async () => {
    task("open", { planned: TODAY });
    task("finished", { planned: TODAY, status: "done" });
    await expect(run({ planned: "today" })).resolves.toEqual(["open"]);
    await expect(run({ planned: "today", status: "any" })).resolves.toEqual([
      "finished",
      "open",
    ]);
  });
});
