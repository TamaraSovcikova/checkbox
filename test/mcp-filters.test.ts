// Saved filters over the connector.
//
// The filter query language is the richest thing in this app and the connector
// could not see it at all: not to run one, not to build one. An agent asked
// "what is in my Week filter" had no way to answer, and no way to say so.
//
// The executor is SHARED with the route (routes/filters runFilterQuery) rather
// than re-implemented here. That is deliberate and these tests are half of why:
// duplicating view SQL between the app and the connector has already leaked once
// (parking), and this query language is the worst place in the codebase for a
// second copy to drift.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { mcp } from "../src/worker/routes/mcp";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const TOKEN = "tok-a";

const brussels = (o = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + o);
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
    INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN}', '${USER}');
    INSERT INTO saved_filters (id, user_id, name, query, position)
      VALUES ('f1', '${USER}', 'Week', '{"due":"week"}', 0);
  `);
  app = new Hono();
  app.route("/", mcp);
});

async function call(name: string, args: Record<string, unknown> = {}) {
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

const task = (id: string, due: string | null, over: { parked?: string } = {}) =>
  raw
    .prepare(
      "INSERT INTO tasks (id, user_id, title, status, due_date, parked_at) VALUES (?, ?, ?, 'todo', ?, ?)"
    )
    .run(id, USER, id, due, over.parked ?? null);

describe("list_filters", () => {
  it("returns each filter with its query, not just its name", async () => {
    // The query is what an agent needs to explain or amend one.
    const out = await call("list_filters");
    expect(out).toContain("Week");
    expect(out).toContain('"due": "week"');
  });
});

describe("run_filter", () => {
  beforeEach(() => {
    task("SOON", brussels(2));
    task("FARAWAY", brussels(90));
  });

  it("runs one by name, because that is what she calls it in a chat", async () => {
    const out = await call("run_filter", { name: "Week" });
    expect(out).toContain("SOON");
    expect(out).not.toContain("FARAWAY");
  });

  it("matches the name case-insensitively but exactly", async () => {
    expect(await call("run_filter", { name: "week" })).toContain("SOON");
    // A substring match would silently run the wrong filter.
    expect(await call("run_filter", { name: "We" })).toContain("not found");
  });

  it("runs one by id too", async () => {
    expect(await call("run_filter", { id: "f1" })).toContain("SOON");
  });

  it("says so rather than guessing when there is no such filter", async () => {
    expect(await call("run_filter", { name: "Nope" })).toContain("not found");
    expect(await call("run_filter", {})).toContain("not found");
  });

  it("obeys the SAME rules as the app, including the parked default", async () => {
    // Proof the executor is shared: `parked` defaults to excluded, which is a
    // rule written once in routes/filters and never restated here.
    task("PARKED-SOON", brussels(2), { parked: "2026-05-01T00:00:00.000Z" });
    const out = await call("run_filter", { name: "Week" });
    expect(out).toContain("SOON");
    expect(out).not.toContain("PARKED-SOON");
  });

  it("honours the date OR, which no preset view can express", async () => {
    raw
      .prepare(
        "INSERT INTO saved_filters (id, user_id, name, query, position) VALUES ('f2', ?, 'Touch', ?, 1)"
      )
      .run(USER, JSON.stringify({ due: "week", planned: "week", dates: "any" }));
    raw
      .prepare(
        "INSERT INTO tasks (id, user_id, title, status, planned_date) VALUES ('PLANNED-ONLY', ?, 'PLANNED-ONLY', 'todo', ?)"
      )
      .run(USER, brussels(2));
    const out = await call("run_filter", { name: "Touch" });
    expect(out).toContain("SOON");
    expect(out).toContain("PLANNED-ONLY");
  });
});

describe("save_filter / delete_filter", () => {
  it("creates one, and it is immediately runnable", async () => {
    task("LATE", brussels(-3));
    const made = await call("save_filter", {
      name: "Late things",
      query: { due: "overdue" },
    });
    expect(made).toContain("Created filter");
    expect(await call("run_filter", { name: "Late things" })).toContain("LATE");
  });

  it("updates one in place when given its id", async () => {
    await call("save_filter", { id: "f1", name: "Renamed", query: { due: "today" } });
    const row = raw
      .prepare("SELECT name, query FROM saved_filters WHERE id = 'f1'")
      .get() as { name: string; query: string };
    expect(row.name).toBe("Renamed");
    expect(JSON.parse(row.query)).toEqual({ due: "today" });
  });

  it("refuses a nameless filter rather than creating an unfindable one", async () => {
    expect(await call("save_filter", { name: "  " })).toContain("name required");
  });

  it("deletes one without touching the tasks it matched", async () => {
    task("SOON", brussels(2));
    await call("delete_filter", { id: "f1" });
    expect(
      (raw.prepare("SELECT COUNT(*) c FROM saved_filters").get() as { c: number }).c
    ).toBe(0);
    expect(
      (raw.prepare("SELECT COUNT(*) c FROM tasks").get() as { c: number }).c
    ).toBe(1);
  });

  it("cannot reach a filter that is not hers", async () => {
    raw.exec(`
      INSERT INTO users (id, email) VALUES ('user-b', 'b@example.com');
      INSERT INTO saved_filters (id, user_id, name, query, position) VALUES ('x', 'user-b', 'Theirs', '{}', 0);
    `);
    expect(await call("delete_filter", { id: "x" })).toContain("not found");
    expect(await call("run_filter", { id: "x" })).toContain("not found");
  });
});
