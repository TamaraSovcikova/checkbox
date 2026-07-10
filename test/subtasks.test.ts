// Subtask -> parent status coupling, and the bulk complete-all endpoint that
// backs the "unfinished subtasks" warning.
//
// Drives the real Hono task routes against an in-memory SQLite DB, so the
// UPDATE ... WHERE status = 'todo' guard and the ownership checks actually run.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { tasks } from "../src/worker/routes/tasks";

const MIGRATIONS = join(__dirname, "..", "migrations");

let raw: Db;
let d1: TestD1;
let app: Hono<any>;

const A = "user-a";
const B = "user-b";
const TOKEN_A = "tok-a";
const TOKEN_B = "tok-b";
const TASK = "task-1";

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${A}', 'a@example.com'), ('${B}', 'b@example.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN_A}', '${A}'), ('${TOKEN_B}', '${B}');
    INSERT INTO tasks (id, user_id, title, status) VALUES ('${TASK}', '${A}', 'Parent', 'todo');
    INSERT INTO subtasks (id, task_id, title, done, position)
      VALUES ('s1', '${TASK}', 'one', 0, 0), ('s2', '${TASK}', 'two', 0, 1);
  `);
  app = new Hono();
  app.route("/api/tasks", tasks);
});

const env = () => ({ DB: d1 }) as any;
const as = (token: string, path: string, init: RequestInit = {}) =>
  app.request(
    path,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers || {}),
      },
    },
    env()
  );

const status = () =>
  (raw.prepare(`SELECT status FROM tasks WHERE id = ?`).get(TASK) as any).status;
const doneCount = () =>
  (raw.prepare(`SELECT COUNT(*) c FROM subtasks WHERE task_id = ? AND done = 1`).get(TASK) as any).c;

const tick = (subId: string, done = true) =>
  as(TOKEN_A, `/api/tasks/${TASK}/subtasks/${subId}`, {
    method: "PATCH",
    body: JSON.stringify({ done }),
  });

describe("subtask progress promotes the parent", () => {
  it("ticking the first subtask moves a todo parent to doing", async () => {
    expect(status()).toBe("todo");
    const res = await tick("s1");
    expect(res.status).toBe(200);
    expect(status()).toBe("doing");
  });

  it("does not promote a parent that is already done", async () => {
    raw.exec(`UPDATE tasks SET status = 'done' WHERE id = '${TASK}'`);
    await tick("s1");
    expect(status()).toBe("done");
  });

  it("un-ticking a subtask never demotes the parent", async () => {
    await tick("s1");
    expect(status()).toBe("doing");
    await tick("s1", false);
    expect(status()).toBe("doing");
  });

  it("renaming a subtask does not touch the parent status", async () => {
    await as(TOKEN_A, `/api/tasks/${TASK}/subtasks/s1`, {
      method: "PATCH",
      body: JSON.stringify({ title: "renamed" }),
    });
    expect(status()).toBe("todo");
  });
});

describe("complete-all subtasks", () => {
  it("ticks every open subtask and reports how many changed", async () => {
    const res = await as(TOKEN_A, `/api/tasks/${TASK}/subtasks/complete-all`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, completed: 2 });
    expect(doneCount()).toBe(2);
  });

  it("is idempotent: a second call completes nothing", async () => {
    await as(TOKEN_A, `/api/tasks/${TASK}/subtasks/complete-all`, { method: "POST" });
    const res = await as(TOKEN_A, `/api/tasks/${TASK}/subtasks/complete-all`, {
      method: "POST",
    });
    expect(await res.json()).toMatchObject({ completed: 0 });
    expect(doneCount()).toBe(2);
  });

  it("B cannot complete A's subtasks", async () => {
    const res = await as(TOKEN_B, `/api/tasks/${TASK}/subtasks/complete-all`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
    expect(doneCount()).toBe(0);
  });
});
