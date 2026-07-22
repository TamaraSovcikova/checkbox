// The set_task_checkpoint MCP tool: it computes the pulse date from the due date
// and stops when there is no headroom. Ownership is enforced.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { mcp } from "../src/worker/routes/mcp";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const TOKEN = "tok-a";
const OTHER = "user-b";
const OTHER_TOKEN = "tok-b";

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

let raw: Db;
let d1: TestD1;
let app: Hono<any>;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com');
    INSERT INTO users (id, email) VALUES ('${OTHER}', 'b@example.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN}', '${USER}');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('${OTHER_TOKEN}', '${OTHER}');
  `);
  app = new Hono();
  app.route("/", mcp);
});

function task(id: string, due: string | null, user = USER) {
  raw
    .prepare(
      "INSERT INTO tasks (id, user_id, title, status, due_date) VALUES (?, ?, ?, 'todo', ?)"
    )
    .run(id, user, id, due);
}

async function call(args: Record<string, unknown>, token = TOKEN) {
  const res = await app.request(
    "/",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "set_task_checkpoint", arguments: args },
      }),
    },
    { DB: d1 } as any
  );
  return ((await res.json()) as any).result?.content?.[0]?.text as string;
}

const readCp = (id: string) =>
  raw
    .prepare("SELECT checkpoint_days, checkpoint_next FROM tasks WHERE id = ?")
    .get(id) as any;

describe("set_task_checkpoint", () => {
  it("sets a checkpoint with a future pulse", async () => {
    task("t", brussels(90));
    const text = await call({ id: "t", days: 14 });
    const cp = readCp("t");
    expect(cp.checkpoint_days).toBe(14);
    expect(cp.checkpoint_next).toBe(brussels(14));
    expect(text).toMatch(/every 14 days/);
  });

  it("refuses when the first pulse would reach the due date, and says why", async () => {
    task("t", brussels(7)); // due in a week, 14-day pulse overshoots
    const text = await call({ id: "t", days: 14 });
    const cp = readCp("t");
    expect(cp.checkpoint_days).toBeNull();
    expect(cp.checkpoint_next).toBeNull();
    expect(text).toMatch(/nothing to pace|on or after the due date/i);
  });

  it("days = 0 turns checkpoints off", async () => {
    task("t", brussels(90));
    await call({ id: "t", days: 14 });
    const text = await call({ id: "t", days: 0 });
    expect(readCp("t").checkpoint_days).toBeNull();
    expect(text).toMatch(/turned off/i);
  });

  it("omitting days turns it off", async () => {
    task("t", brussels(90));
    await call({ id: "t", days: 14 });
    await call({ id: "t" });
    expect(readCp("t").checkpoint_days).toBeNull();
  });

  it("works with no due date (runs indefinitely)", async () => {
    task("t", null);
    await call({ id: "t", days: 30 });
    const cp = readCp("t");
    expect(cp.checkpoint_days).toBe(30);
    expect(cp.checkpoint_next).toBe(brussels(30));
  });

  it("refuses another user's task and writes nothing", async () => {
    task("theirs", brussels(90), OTHER);
    const text = await call({ id: "theirs", days: 14 });
    expect(text).toMatch(/not found/i);
    expect(readCp("theirs").checkpoint_days).toBeNull();
  });

  it("is advertised in tools/list", async () => {
    const res = await app.request(
      "/",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      },
      { DB: d1 } as any
    );
    const names = ((await res.json()) as any).result.tools.map((t: any) => t.name);
    expect(names).toContain("set_task_checkpoint");
  });
});
