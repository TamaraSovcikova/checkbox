// Completing a recurring task rolls it forward AND lets go of today: the next
// occurrence must not keep today's planned_date or time block, or it clings to
// the Today view forever. Drives the real complete route against SQLite.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { tasks } from "../src/worker/routes/tasks";

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
// The recur path fires a GCal push via c.executionCtx.waitUntil; Hono's getter
// throws when no execution context is supplied, so provide a stub.
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
      "SELECT status, due_date, planned_date, scheduled_start, scheduled_end FROM tasks WHERE id = ?"
    )
    .get(id) as any;

describe("completing a recurring task lets go of today", () => {
  beforeEach(() => {
    raw.exec(`
      INSERT INTO tasks
        (id, user_id, title, status, recurrence, recurrence_mode, due_date, planned_date, scheduled_start, scheduled_end)
      VALUES
        ('t-rec', '${U}', 'Water plants', 'todo', 'daily', 'fixed',
         '2026-07-10', '2026-07-10', '2026-07-10T09:00:00', '2026-07-10T09:15:00');
    `);
  });

  it("rolls due_date forward and stays todo", async () => {
    const res = await complete("t-rec");
    const body = await res.json();
    expect(body.recurred).toBe(true);
    const r = row("t-rec");
    expect(r.status).toBe("todo");
    expect(r.due_date > "2026-07-10").toBe(true);
  });

  it("clears planned_date and the time block so it leaves Today", async () => {
    await complete("t-rec");
    const r = row("t-rec");
    expect(r.planned_date).toBeNull();
    expect(r.scheduled_start).toBeNull();
    expect(r.scheduled_end).toBeNull();
  });
});

describe("completing a non-recurring task is unaffected", () => {
  it("marks done and keeps planned_date", async () => {
    raw.exec(`
      INSERT INTO tasks (id, user_id, title, status, planned_date)
      VALUES ('t-plain', '${U}', 'One off', 'todo', '2026-07-10');
    `);
    const res = await complete("t-plain");
    expect((await res.json()).recurred).toBe(false);
    const r = row("t-plain");
    expect(r.status).toBe("done");
    expect(r.planned_date).toBe("2026-07-10");
  });
});
