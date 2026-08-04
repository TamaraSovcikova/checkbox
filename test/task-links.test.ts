// Related task links: symmetric, non-blocking, and hydrated onto both sides.
//
// Drives the real Hono routes against an in-memory SQLite DB, so the batch that
// writes both directions and the ownership checks actually run. The property
// worth pinning is the symmetry: a link written from either end must be visible
// and removable from the other, because the UI offers exactly that.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { tasks } from "../src/worker/routes/tasks";
import type { Task } from "../src/shared/types";

const MIGRATIONS = join(__dirname, "..", "migrations");

let raw: Db;
let d1: TestD1;
let app: Hono<any>;

const A = "user-a";
const B = "user-b";
const TOKEN_A = "tok-a";
const TOKEN_B = "tok-b";

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${A}', 'a@example.com'), ('${B}', 'b@example.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN_A}', '${A}'), ('${TOKEN_B}', '${B}');
    INSERT INTO tasks (id, user_id, title, status) VALUES
      ('t1', '${A}', 'Book the flights', 'todo'),
      ('t2', '${A}', 'Renew the passport', 'todo'),
      ('t3', '${A}', 'Unrelated', 'todo'),
      ('b1', '${B}', 'Not hers', 'todo');
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

const link = (from: string, to: string, token = TOKEN_A) =>
  as(token, `/api/tasks/${from}/links`, {
    method: "POST",
    body: JSON.stringify({ linked_id: to }),
  });

const unlink = (from: string, to: string, token = TOKEN_A) =>
  as(token, `/api/tasks/${from}/links/${to}`, { method: "DELETE" });

const rows = () =>
  raw.prepare(`SELECT task_id, linked_id FROM task_links ORDER BY task_id`).all() as {
    task_id: string;
    linked_id: string;
  }[];

const getTask = async (id: string): Promise<Task> => {
  const res = await as(TOKEN_A, `/api/tasks/${id}`);
  return (await res.json()) as Task;
};

describe("related links are symmetric", () => {
  it("one call writes both directions", async () => {
    const res = await link("t1", "t2");
    expect(res.status).toBe(200);
    expect(rows()).toEqual([
      { task_id: "t1", linked_id: "t2" },
      { task_id: "t2", linked_id: "t1" },
    ]);
  });

  it("both tasks hydrate the other as related", async () => {
    await link("t1", "t2");
    expect((await getTask("t1")).related).toEqual([
      { id: "t2", title: "Renew the passport", status: "todo" },
    ]);
    expect((await getTask("t2")).related).toEqual([
      { id: "t1", title: "Book the flights", status: "todo" },
    ]);
  });

  // The link has no "from", so removing it from the far end must work: the sheet
  // shows the same link on both tasks with the same remove button.
  it("removing from the OTHER end removes the pair", async () => {
    await link("t1", "t2");
    const res = await unlink("t2", "t1");
    expect(res.status).toBe(200);
    expect(rows()).toEqual([]);
    expect((await getTask("t1")).related).toEqual([]);
  });

  it("linking twice is a no-op, not a duplicate", async () => {
    await link("t1", "t2");
    await link("t2", "t1");
    expect(rows()).toHaveLength(2);
  });

  it("a task can hold several links", async () => {
    await link("t1", "t2");
    await link("t1", "t3");
    const related = (await getTask("t1")).related ?? [];
    expect(related.map((r) => r.id).sort()).toEqual(["t2", "t3"]);
  });
});

describe("links are guarded", () => {
  it("rejects a self-link", async () => {
    const res = await link("t1", "t1");
    expect(res.status).toBe(400);
    expect(rows()).toEqual([]);
  });

  it("rejects a link to another user's task", async () => {
    const res = await link("t1", "b1");
    expect(res.status).toBe(404);
    expect(rows()).toEqual([]);
  });

  it("rejects a link FROM another user's task", async () => {
    const res = await link("b1", "t1");
    expect(res.status).toBe(404);
    expect(rows()).toEqual([]);
  });
});

describe("links say nothing about order", () => {
  // The whole point of the separate table: a related task must never block, or
  // the Flow runway would grow edges nobody drew.
  it("a link creates no dependency rows", async () => {
    await link("t1", "t2");
    const deps = raw.prepare(`SELECT COUNT(*) c FROM task_dependencies`).get() as {
      c: number;
    };
    expect(deps.c).toBe(0);
    const t1 = await getTask("t1");
    expect(t1.depends_on).toEqual([]);
    expect(t1.blocks).toEqual([]);
  });

  it("deleting a task takes its links with it", async () => {
    await link("t1", "t2");
    await as(TOKEN_A, `/api/tasks/t2`, { method: "DELETE" });
    expect(rows()).toEqual([]);
    expect((await getTask("t1")).related).toEqual([]);
  });
});
