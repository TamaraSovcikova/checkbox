// Two-user data-isolation test (M1 ship gate).
// Seeds user A with data, then drives the real Hono route modules as user B
// (via a per-user MCP bearer token) and asserts B can neither see nor mutate
// A's rows. Uses a real in-memory SQLite DB so the WHERE user_id guards run.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { tasks } from "../src/worker/routes/tasks";
import { areas } from "../src/worker/routes/areas";
import { projects } from "../src/worker/routes/projects";

const MIGRATIONS = join(__dirname, "..", "migrations");

let raw: Db;
let d1: TestD1;
let app: Hono<any>;

// Seed two users, their MCP tokens, and one area/project/task owned by A.
const A = "user-a";
const B = "user-b";
const TOKEN_A = "tok-a";
const TOKEN_B = "tok-b";
const A_AREA = "area-a";
const A_PROJECT = "proj-a";
const A_TASK = "task-a";

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${A}', 'a@example.com'), ('${B}', 'b@example.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN_A}', '${A}'), ('${TOKEN_B}', '${B}');
    INSERT INTO areas (id, user_id, name) VALUES ('${A_AREA}', '${A}', 'A Area');
    INSERT INTO projects (id, user_id, area_id, name) VALUES ('${A_PROJECT}', '${A}', '${A_AREA}', 'A Project');
    INSERT INTO tasks (id, user_id, area_id, title) VALUES ('${A_TASK}', '${A}', '${A_AREA}', 'A secret task');
    INSERT INTO subtasks (id, task_id, title) VALUES ('sub-a', '${A_TASK}', 'A subtask');
  `);

  app = new Hono();
  app.route("/api/tasks", tasks);
  app.route("/api/areas", areas);
  app.route("/api/projects", projects);
});

const env = () => ({ DB: d1 }) as any;
const as = (token: string, path: string, init: RequestInit = {}) =>
  app.request(
    path,
    { ...init, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) } },
    env()
  );

describe("cross-user isolation", () => {
  it("owner (A) can read their own task", async () => {
    const res = await as(TOKEN_A, `/api/tasks/${A_TASK}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("A secret task");
  });

  it("B cannot see A's task in the list", async () => {
    const res = await as(TOKEN_B, "/api/tasks");
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list.find((t: any) => t.id === A_TASK)).toBeUndefined();
  });

  it("B gets 404 fetching A's task by id", async () => {
    const res = await as(TOKEN_B, `/api/tasks/${A_TASK}`);
    expect(res.status).toBe(404);
  });

  it("B gets 404 patching A's task (and the row is unchanged)", async () => {
    const res = await as(TOKEN_B, `/api/tasks/${A_TASK}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "hacked" }),
    });
    expect(res.status).toBe(404);
    const row = raw.prepare("SELECT title FROM tasks WHERE id = ?").get(A_TASK) as any;
    expect(row.title).toBe("A secret task");
  });

  it("B cannot add a subtask to A's task", async () => {
    const res = await as(TOKEN_B, `/api/tasks/${A_TASK}/subtasks`, {
      method: "POST",
      body: JSON.stringify({ title: "injected" }),
    });
    expect(res.status).toBe(404);
    const count = raw
      .prepare("SELECT COUNT(*) c FROM subtasks WHERE task_id = ?")
      .get(A_TASK) as any;
    expect(count.c).toBe(1); // only A's original subtask
  });

  it("B cannot delete A's subtask via a guessed id", async () => {
    const res = await as(TOKEN_B, `/api/tasks/${A_TASK}/subtasks/sub-a`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    const count = raw
      .prepare("SELECT COUNT(*) c FROM subtasks WHERE id = 'sub-a'")
      .get() as any;
    expect(count.c).toBe(1);
  });

  it("B cannot create a task pointing at A's area (FK injection)", async () => {
    const res = await as(TOKEN_B, "/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "mine", area_id: A_AREA }),
    });
    expect(res.status).toBe(400);
  });

  it("B cannot create a task pointing at A's project (FK injection)", async () => {
    const res = await as(TOKEN_B, "/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "mine", project_id: A_PROJECT }),
    });
    expect(res.status).toBe(400);
  });

  it("B cannot move their task into A's project via PATCH", async () => {
    // B creates a legit task first.
    const created = await (
      await as(TOKEN_B, "/api/tasks", {
        method: "POST",
        body: JSON.stringify({ title: "B task" }),
      })
    ).json();
    const res = await as(TOKEN_B, `/api/tasks/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ project_id: A_PROJECT }),
    });
    expect(res.status).toBe(400);
  });

  it("B sees none of A's areas", async () => {
    const res = await as(TOKEN_B, "/api/areas");
    const list = await res.json();
    expect(list.find((a: any) => a.id === A_AREA)).toBeUndefined();
  });

  it("unauthenticated request is rejected (401)", async () => {
    const res = await app.request("/api/tasks", {}, env());
    expect(res.status).toBe(401);
  });
});
