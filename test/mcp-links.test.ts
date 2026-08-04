// The link_tasks / unlink_tasks MCP tools. Same symmetry and ownership rules as
// the HTTP routes (test/task-links.test.ts); pinned separately because the MCP
// dispatch writes its own SQL rather than calling the route.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { mcp } from "../src/worker/routes/mcp";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const TOKEN = "tok-a";
const OTHER = "user-b";

let raw: Db;
let d1: TestD1;
let app: Hono<any>;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com'), ('${OTHER}', 'b@example.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN}', '${USER}');
    INSERT INTO tasks (id, user_id, title, status) VALUES
      ('t1', '${USER}', 'Book the flights', 'todo'),
      ('t2', '${USER}', 'Renew the passport', 'todo'),
      ('b1', '${OTHER}', 'Not hers', 'todo');
  `);
  app = new Hono();
  app.route("/", mcp);
});

async function call(name: string, args: Record<string, unknown>) {
  const res = await app.request(
    "/",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    },
    { DB: d1 } as any
  );
  return ((await res.json()) as any).result?.content?.[0]?.text as string;
}

const rows = () =>
  raw.prepare("SELECT task_id, linked_id FROM task_links ORDER BY task_id").all() as {
    task_id: string;
    linked_id: string;
  }[];

describe("link_tasks", () => {
  it("writes both directions in one call", async () => {
    const text = await call("link_tasks", { task_id: "t1", linked_id: "t2" });
    expect(text).toMatch(/related/i);
    expect(rows()).toEqual([
      { task_id: "t1", linked_id: "t2" },
      { task_id: "t2", linked_id: "t1" },
    ]);
  });

  it("creates no dependency: a link never blocks", async () => {
    await call("link_tasks", { task_id: "t1", linked_id: "t2" });
    const deps = raw.prepare("SELECT COUNT(*) c FROM task_dependencies").get() as { c: number };
    expect(deps.c).toBe(0);
  });

  it("refuses a self-link", async () => {
    const text = await call("link_tasks", { task_id: "t1", linked_id: "t1" });
    expect(text).toMatch(/itself/i);
    expect(rows()).toEqual([]);
  });

  it("refuses another user's task", async () => {
    const text = await call("link_tasks", { task_id: "t1", linked_id: "b1" });
    expect(text).toMatch(/not found/i);
    expect(rows()).toEqual([]);
  });
});

describe("unlink_tasks", () => {
  it("removes the pair from either end", async () => {
    await call("link_tasks", { task_id: "t1", linked_id: "t2" });
    await call("unlink_tasks", { task_id: "t2", linked_id: "t1" });
    expect(rows()).toEqual([]);
  });
});
