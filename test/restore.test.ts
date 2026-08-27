// Undoing a delete must give back the task you had, not a flattened copy.
//
// Restore is an UNDO path, which is where fidelity matters most: you press it
// because you did not mean to lose anything. It rebuilds the task row from the
// client's snapshot, and everything it forgets is gone for good, silently,
// with a toast that said the undo worked.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { tasks } from "../src/worker/routes/tasks";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const TOKEN = "tok-a";

let raw: Db;
let d1: TestD1;
let app: Hono<any>;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN}', '${USER}');
    INSERT INTO tasks (id, user_id, title, status) VALUES ('keeper', '${USER}', 'Still here', 'todo');
  `);
  app = new Hono();
  app.route("/", tasks);
});

const restore = (snapshot: unknown) =>
  app.request(
    "/restore",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(snapshot),
    },
    { DB: d1 } as any,
    ctx
  );

const snapshot = (over: Record<string, unknown> = {}) => ({
  id: "gone",
  title: "Deleted task",
  status: "todo",
  priority: 2,
  due_date: "2026-09-01",
  subtasks: [],
  labels: [],
  depends_on: [],
  related: [],
  ...over,
});

const subs = () =>
  raw
    .prepare("SELECT title, due_date, priority, done FROM subtasks WHERE task_id = 'gone' ORDER BY position")
    .all() as { title: string; due_date: string | null; priority: number | null; done: number }[];

describe("undo delete", () => {
  it("brings the task itself back", async () => {
    const res = await restore(snapshot());
    expect(res.status).toBe(201);
    const row = raw.prepare("SELECT title, due_date FROM tasks WHERE id = 'gone'").get() as any;
    expect(row.title).toBe("Deleted task");
    expect(row.due_date).toBe("2026-09-01");
  });

  it("keeps each step's DUE DATE and PRIORITY, not just its title", async () => {
    // A step's due date carries its parent into Today, so losing it changes what
    // the app shows you tomorrow. It was being dropped on the floor.
    await restore(
      snapshot({
        subtasks: [
          { title: "post the form", done: false, position: 0, due_date: "2026-09-03", priority: 1 },
          { title: "file it", done: true, position: 1, due_date: null, priority: null },
        ],
      })
    );
    expect(subs()).toEqual([
      { title: "post the form", due_date: "2026-09-03", priority: 1, done: 0 },
      { title: "file it", due_date: null, priority: null, done: 1 },
    ]);
  });

  it("brings back blockers and related links, which cascade away on delete", async () => {
    // task_links and task_dependencies are ON DELETE CASCADE, so deleting the
    // task destroys them. The snapshot is the only record left; ignoring it made
    // undo quietly lossy.
    await restore(
      snapshot({
        depends_on: [{ id: "keeper", title: "Still here", status: "todo" }],
        related: [{ id: "keeper", title: "Still here", status: "todo" }],
      })
    );
    const deps = raw
      .prepare("SELECT depends_on_id FROM task_dependencies WHERE task_id = 'gone'")
      .all() as { depends_on_id: string }[];
    expect(deps.map((d) => d.depends_on_id)).toEqual(["keeper"]);
    // Links are symmetric: both rows, or neither end can show it.
    const links = raw
      .prepare("SELECT task_id, linked_id FROM task_links ORDER BY task_id")
      .all() as { task_id: string; linked_id: string }[];
    expect(links).toEqual([
      { task_id: "gone", linked_id: "keeper" },
      { task_id: "keeper", linked_id: "gone" },
    ]);
  });

  it("drops a blocker or link whose other end is gone too, rather than failing", async () => {
    const res = await restore(
      snapshot({
        depends_on: [{ id: "vanished", title: "Deleted as well", status: "todo" }],
        related: [{ id: "vanished", title: "Deleted as well", status: "todo" }],
      })
    );
    expect(res.status).toBe(201);
    const n = raw
      .prepare("SELECT COUNT(*) c FROM task_dependencies WHERE task_id = 'gone'")
      .get() as { c: number };
    expect(n.c).toBe(0);
  });

  it("is idempotent: pressing undo twice does not double the steps", async () => {
    const snap = snapshot({
      subtasks: [{ title: "post the form", done: false, position: 0 }],
    });
    await restore(snap);
    await restore(snap);
    expect(subs()).toHaveLength(1);
  });

  it("refuses a malformed date instead of writing one, like every other writer", async () => {
    const res = await restore(snapshot({ due_date: "null" }));
    // Either cleared to NULL or rejected outright, but never the text "null".
    const row = raw.prepare("SELECT due_date FROM tasks WHERE id = 'gone'").get() as any;
    if (res.status === 201) expect(row?.due_date).toBeNull();
    else expect(row).toBeUndefined();
  });
});
