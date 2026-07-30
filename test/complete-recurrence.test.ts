// Recurring tasks: completion now COMPLETES (crossed out in today's Done,
// counted in stats), and the 06:00 sweep (lib/resurrect) wakes the task as
// its next occurrence the following morning. The old immediate-roll made a
// finished daily vanish and instantly resurface "due tomorrow". Drives the
// real complete route + the real sweep against SQLite.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { tasks } from "../src/worker/routes/tasks";
import { resurrectRecurring } from "../src/worker/lib/resurrect";
import { resurrectionDecision } from "../src/shared/recurrence";

const MIGRATIONS = join(__dirname, "..", "migrations");

let raw: Db;
let d1: TestD1;
let app: Hono<any>;

const U = "user-a";
const TOKEN = "tok-a";

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${U}', 'a@example.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN}', '${U}');
  `);
  app = new Hono();
  app.route("/api/tasks", tasks);
});

const env = () => ({ DB: d1 }) as any;
const execCtx = () =>
  ({ waitUntil: () => {}, passThroughOnException: () => {} }) as any;
const complete = (id: string) =>
  app.request(
    `/api/tasks/${id}/complete`,
    { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` } },
    env(),
    execCtx()
  );
const row = (id: string) =>
  raw
    .prepare(
      `SELECT status, due_date, planned_date, scheduled_start, completed_at,
              recurrence, recurrence_count FROM tasks WHERE id = ?`
    )
    .get(id) as any;

function seed(id: string, over: Record<string, unknown> = {}): void {
  const cols = {
    id,
    user_id: U,
    title: id,
    status: "todo",
    recurrence: null,
    recurrence_mode: "fixed",
    due_date: null,
    planned_date: null,
    completed_at: null,
    recurrence_until: null,
    recurrence_count: null,
    ...over,
  } as Record<string, unknown>;
  const keys = Object.keys(cols);
  raw
    .prepare(
      `INSERT INTO tasks (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`
    )
    .run(...keys.map((k) => cols[k]));
}

describe("completing a recurring task now genuinely completes it", () => {
  it("marks done with completed_at; the date does NOT roll until the sweep", async () => {
    seed("t1", { recurrence: "daily", due_date: "2026-07-28", planned_date: "2026-07-28" });
    const res = await complete("t1");
    expect(res.status).toBe(200);
    const r = row("t1");
    expect(r.status).toBe("done");
    expect(r.completed_at).toBeTruthy();
    expect(r.due_date).toBe("2026-07-28");
    expect(r.recurrence).toBe("daily");
  });

  it("a plain task is unaffected", async () => {
    seed("t2", { planned_date: "2026-07-10" });
    const res = await complete("t2");
    expect((await res.json()).recurred).toBe(false);
    const r = row("t2");
    expect(r.status).toBe("done");
    expect(r.planned_date).toBe("2026-07-10");
  });
});

describe("the morning sweep wakes yesterday's completions", () => {
  it("rolls to the next occurrence, resets checklist, clears plan and block", async () => {
    seed("t1", {
      recurrence: "daily",
      due_date: "2026-07-27",
      completed_at: "2026-07-27T18:00:00.000Z",
      status: "done",
      planned_date: "2026-07-27",
      scheduled_start: "2026-07-27T09:00:00",
    });
    raw.exec(
      `INSERT INTO subtasks (id, task_id, title, done, position) VALUES ('s1','t1','step',1,0);`
    );
    const woken = await resurrectRecurring(env(), "2026-07-28");
    expect(woken).toBe(1);
    const r = row("t1");
    expect(r.status).toBe("todo");
    expect(r.completed_at).toBeNull();
    expect(r.due_date).toBe("2026-07-28");
    expect(r.planned_date).toBeNull();
    expect(r.scheduled_start).toBeNull();
    const sub = raw.prepare("SELECT done FROM subtasks WHERE id = 's1'").get() as any;
    expect(sub.done).toBe(0);
  });

  it("leaves TODAY's completions resting until tomorrow", async () => {
    seed("t1", {
      recurrence: "daily",
      due_date: "2026-07-28",
      completed_at: "2026-07-28T09:00:00.000Z",
      status: "done",
    });
    const woken = await resurrectRecurring(env(), "2026-07-28");
    expect(woken).toBe(0);
    expect(row("t1").status).toBe("done");
  });

  it("catches up a long-overdue daily to today instead of a stale date", async () => {
    seed("t1", {
      recurrence: "daily",
      due_date: "2026-07-20",
      completed_at: "2026-07-27T18:00:00.000Z",
      status: "done",
    });
    await resurrectRecurring(env(), "2026-07-28");
    expect(row("t1").due_date).toBe("2026-07-28");
  });

  it("after_completion anchors at the completion day", async () => {
    seed("t1", {
      recurrence: "every:3:day",
      recurrence_mode: "after_completion",
      due_date: "2026-07-20",
      completed_at: "2026-07-27T18:00:00.000Z",
      status: "done",
    });
    await resurrectRecurring(env(), "2026-07-28");
    expect(row("t1").due_date).toBe("2026-07-30");
  });

  it("a count of 1 or a passed until ends the series: stays done, recurrence off", async () => {
    seed("t1", {
      recurrence: "daily",
      due_date: "2026-07-27",
      completed_at: "2026-07-27T18:00:00.000Z",
      status: "done",
      recurrence_count: 1,
    });
    seed("t2", {
      recurrence: "daily",
      due_date: "2026-07-27",
      completed_at: "2026-07-27T18:00:00.000Z",
      status: "done",
      recurrence_until: "2026-07-27",
    });
    const woken = await resurrectRecurring(env(), "2026-07-28");
    expect(woken).toBe(0);
    for (const id of ["t1", "t2"]) {
      const r = row(id);
      expect(r.status).toBe("done");
      expect(r.recurrence).toBeNull();
    }
  });

  it("a stale catch-up still costs exactly ONE count", async () => {
    seed("t1", {
      recurrence: "daily",
      due_date: "2026-07-20",
      completed_at: "2026-07-27T18:00:00.000Z",
      status: "done",
      recurrence_count: 3,
    });
    await resurrectRecurring(env(), "2026-07-28");
    expect(row("t1").recurrence_count).toBe(2);
  });
});

describe("resurrectionDecision (pure)", () => {
  it("weekday spec lands on the next weekday no earlier than today", () => {
    const d = resurrectionDecision(
      "weekdays", "fixed", "2026-07-24", "2026-07-24", null, null, "2026-07-28"
    );
    expect(d).toEqual({ kind: "roll", due_date: "2026-07-28", recurrence_count: null });
  });
});
