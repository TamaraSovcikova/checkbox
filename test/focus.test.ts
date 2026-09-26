// Issue #3: Today's Focus. An ordered shortlist that belongs to one day,
// writable from the app and over MCP, that never touches another user's tasks.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { focus } from "../src/worker/routes/focus";
import { mcp } from "../src/worker/routes/mcp";
import { focusList, moveFocus, toggleFocus } from "../src/shared/focus";
import { todayIn } from "../src/shared/tz";

const MIGRATIONS = join(__dirname, "..", "migrations");
const TODAY = todayIn("Europe/Brussels");
const AUTH = { Authorization: "Bearer tok-a", "Content-Type": "application/json" };

let raw: Db;
let d1: TestD1;
const env = () => ({ DB: d1 }) as any;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('a', 'a@example.com'), ('b', 'b@example.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('tok-a', 'a');
    INSERT INTO tasks (id, user_id, title, status, planned_date, due_date) VALUES
      ('t1', 'a', 'One', 'todo', NULL, NULL),
      ('t2', 'a', 'Two', 'todo', '2020-01-01', NULL),
      ('t3', 'a', 'Three', 'todo', NULL, '2020-01-01'),
      ('t4', 'a', 'Done', 'done', NULL, NULL),
      ('theirs', 'b', 'Theirs', 'todo', NULL, NULL);
  `);
});

const app = new Hono().route("/", focus);
const put = (ids: unknown) =>
  app.request("/", { method: "PUT", headers: AUTH, body: JSON.stringify({ ids }) }, env());
const row = (id: string) =>
  raw.prepare("SELECT focus_date, focus_rank, planned_date FROM tasks WHERE id = ?").get(id) as any;

describe("PUT /api/focus", () => {
  it("stores today's order, first = rank 1", async () => {
    expect((await put(["t3", "t1"])).status).toBe(200);
    expect(row("t3")).toMatchObject({ focus_date: TODAY, focus_rank: 1 });
    expect(row("t1")).toMatchObject({ focus_date: TODAY, focus_rank: 2 });
  });

  it("replaces the previous focus rather than adding to it", async () => {
    await put(["t1", "t2"]);
    await put(["t2"]);
    expect(row("t1").focus_date).toBeNull();
    expect(row("t2")).toMatchObject({ focus_rank: 1 });
  });

  it("puts a focused task in Today, but never moves an earlier plan or a due task", async () => {
    await put(["t1", "t2", "t3"]);
    expect(row("t1").planned_date).toBe(TODAY); // nowhere near Today: planned now
    expect(row("t2").planned_date).toBe("2020-01-01"); // already carried into Today
    expect(row("t3").planned_date).toBeNull(); // overdue: already in Today
  });

  it("refuses someone else's task and done tasks, and writes nothing", async () => {
    expect((await put(["t1", "theirs"])).status).toBe(400);
    expect((await put(["t4"])).status).toBe(400);
    expect(row("t1").focus_date).toBeNull();
  });

  it("an empty list clears", async () => {
    await put(["t1"]);
    await put([]);
    expect(row("t1").focus_date).toBeNull();
  });
});

describe("GET /api/focus", () => {
  it("returns today's focus in order", async () => {
    await put(["t2", "t1"]);
    const r = (await (await app.request("/", { headers: AUTH }, env())).json()) as any;
    expect(r.tasks.map((t: any) => t.id)).toEqual(["t2", "t1"]);
    expect(r.carryover).toEqual([]);
  });

  it("offers the last focus day's unfinished tasks when today has none", async () => {
    raw.exec(`
      UPDATE tasks SET focus_date = '2020-01-05', focus_rank = 2 WHERE id = 't1';
      UPDATE tasks SET focus_date = '2020-01-05', focus_rank = 1 WHERE id = 't2';
      UPDATE tasks SET focus_date = '2020-01-05', focus_rank = 3 WHERE id = 't4';
    `);
    const r = (await (await app.request("/", { headers: AUTH }, env())).json()) as any;
    expect(r.tasks).toEqual([]);
    expect(r.carryover.map((t: any) => t.id)).toEqual(["t2", "t1"]); // done one left out
  });
});

describe("MCP set_focus", () => {
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await new Hono().route("/", mcp).request(
      "/",
      {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      },
      env()
    );
    return (await res.json()) as any;
  };

  it("sets focus by code and reads it back in order", async () => {
    const seq = (id: string) => (raw.prepare("SELECT seq FROM tasks WHERE id = ?").get(id) as any).seq;
    await call("set_focus", { ids: [`CB-${seq("t3")}`, "t1"] });
    expect(row("t3").focus_rank).toBe(1);
    const listed = await call("list_tasks", { view: "focus" });
    const body = listed.result.content[0].text as string;
    expect(body.indexOf("Three")).toBeLessThan(body.indexOf("One"));
  });
});

describe("shared/focus", () => {
  it("orders, toggles and moves", () => {
    const ts = [
      { id: "a", focus_date: TODAY, focus_rank: 2, status: "todo" },
      { id: "b", focus_date: TODAY, focus_rank: 1, status: "todo" },
      { id: "c", focus_date: "2020-01-01", focus_rank: 1, status: "todo" },
      { id: "d", focus_date: TODAY, focus_rank: 3, status: "done" },
    ];
    expect(focusList(ts, TODAY).map((t) => t.id)).toEqual(["b", "a"]);
    expect(toggleFocus(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleFocus(["a"], "c")).toEqual(["a", "c"]);
    expect(moveFocus(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
  });
});
