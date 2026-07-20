// The cadence tracker tools over MCP. These are what let a chat answer "who
// have I not spoken to in a while" and then log the call afterwards, so the
// ordering and the never-logged case are the parts that matter.

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

// Same zone the route uses, so seeded offsets line up at any hour.
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

async function call(tool: string, args: Record<string, unknown> = {}, token = TOKEN) {
  const res = await app.request(
    "/",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool, arguments: args },
      }),
    },
    { DB: d1 } as any
  );
  const body = (await res.json()) as any;
  const content = body?.result?.content?.[0]?.text;
  try {
    return { raw: body, data: content ? JSON.parse(content) : null, text: content };
  } catch {
    return { raw: body, data: null, text: content };
  }
}

// Seed straight into the DB so the arrange step does not depend on create_tracker.
function seed(
  id: string,
  name: string,
  targetDays: number | null,
  lastDaysAgo: number | null,
  user = USER
) {
  raw
    .prepare(
      "INSERT INTO trackers (id, user_id, name, kind, target_days, created_at) VALUES (?, ?, ?, 'contact', ?, '2026-01-01')"
    )
    .run(id, user, name, targetDays);
  if (lastDaysAgo != null) {
    raw
      .prepare(
        "INSERT INTO tracker_events (id, user_id, tracker_id, occurred_at) VALUES (?, ?, ?, ?)"
      )
      .run(`e-${id}`, user, id, `${brussels(-lastDaysAgo)}T10:00:00.000Z`);
  }
}

describe("list_trackers", () => {
  it("reports days since, and null when never logged", async () => {
    seed("a", "Ivka", 14, 21);
    seed("b", "Dentist", 180, null);
    const { data } = await call("list_trackers");
    const byName = Object.fromEntries(data.trackers.map((t: any) => [t.name, t]));
    expect(byName.Ivka.days_since).toBe(21);
    expect(byName.Dentist.days_since).toBeNull();
  });

  it("orders the most neglected first, by ratio not raw days", async () => {
    // 20/14 = 1.4 vs 8/3 = 2.7: fewer days, but further past its cadence.
    seed("a", "Fortnightly", 14, 20);
    seed("b", "EveryThree", 3, 8);
    const { data } = await call("list_trackers");
    expect(data.trackers.map((t: any) => t.name)).toEqual(["EveryThree", "Fortnightly"]);
  });

  it("marks due, and never-logged with a target counts as due", async () => {
    seed("a", "Late", 7, 30);
    seed("b", "Fresh", 30, 1);
    seed("c", "Never", 90, null);
    const { data } = await call("list_trackers");
    const byName = Object.fromEntries(data.trackers.map((t: any) => [t.name, t]));
    expect(byName.Late.due).toBe(true);
    expect(byName.Fresh.due).toBe(false);
    expect(byName.Never.due).toBe(true);
  });

  // Omitting a target means "count it, do not nag": it can never be late.
  it("never marks an untargeted tracker due, however old", async () => {
    seed("a", "Loose", null, 400);
    const { data } = await call("list_trackers");
    expect(data.trackers[0].due).toBe(false);
    expect(data.trackers[0].days_since).toBe(400);
  });

  it("due_only filters to what needs attention", async () => {
    seed("a", "Late", 7, 30);
    seed("b", "Fresh", 30, 1);
    const { data } = await call("list_trackers", { due_only: true });
    expect(data.trackers.map((t: any) => t.name)).toEqual(["Late"]);
  });

  it("filters by area", async () => {
    raw.prepare("INSERT INTO areas (id, user_id, name) VALUES ('ar1', ?, 'People')").run(USER);
    seed("a", "InArea", 7, 1);
    raw.prepare("UPDATE trackers SET area_id = 'ar1' WHERE id = 'a'").run();
    seed("b", "Elsewhere", 7, 1);
    const { data } = await call("list_trackers", { area_id: "ar1" });
    expect(data.trackers.map((t: any) => t.name)).toEqual(["InArea"]);
  });

  it("does not leak another user's trackers", async () => {
    seed("mine", "Mine", 7, 1);
    seed("theirs", "Theirs", 7, 1, OTHER);
    const { data } = await call("list_trackers");
    expect(data.trackers.map((t: any) => t.name)).toEqual(["Mine"]);
  });
});

describe("log_tracker", () => {
  it("logging resets the counter to today", async () => {
    seed("a", "Ivka", 14, 21);
    await call("log_tracker", { id: "a" });
    const { data } = await call("list_trackers");
    expect(data.trackers[0].days_since).toBe(0);
    expect(data.trackers[0].due).toBe(false);
  });

  it("accepts a bare date and does not slide it across a timezone", async () => {
    seed("a", "Ivka", 14, 21);
    const day = brussels(-3);
    await call("log_tracker", { id: "a", occurred_at: day });
    const { data } = await call("list_trackers");
    expect(data.trackers[0].days_since).toBe(3);
  });

  it("refuses another user's tracker and writes nothing", async () => {
    seed("theirs", "Theirs", 7, 30, OTHER);
    const { text } = await call("log_tracker", { id: "theirs" });
    expect(text).toMatch(/not found/i);
    const n = raw.prepare("SELECT COUNT(*) AS n FROM tracker_events").get() as any;
    expect(n.n).toBe(1); // only the seeded one
  });
});

describe("create_tracker", () => {
  it("creates one, and it comes back never-logged", async () => {
    await call("create_tracker", { name: "Mum", target_days: 10 });
    const { data } = await call("list_trackers");
    expect(data.trackers[0].name).toBe("Mum");
    expect(data.trackers[0].target_days).toBe(10);
    expect(data.trackers[0].days_since).toBeNull();
  });

  it("treats a non-positive target as no target", async () => {
    await call("create_tracker", { name: "Loose", target_days: 0 });
    const { data } = await call("list_trackers");
    expect(data.trackers[0].target_days).toBeNull();
  });

  it("can record that it already happened", async () => {
    await call("create_tracker", {
      name: "Mum",
      target_days: 10,
      last_at: `${brussels(-2)}T09:00:00.000Z`,
    });
    const { data } = await call("list_trackers");
    expect(data.trackers[0].days_since).toBe(2);
  });

  it("rejects a nameless tracker", async () => {
    const { text } = await call("create_tracker", { name: "  " });
    expect(text).toMatch(/name is required/i);
  });
});

describe("tool registration", () => {
  it("advertises the three tracker tools", async () => {
    const res = await app.request(
      "/",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      },
      { DB: d1 } as any
    );
    const body = (await res.json()) as any;
    const names = body.result.tools.map((t: any) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["list_trackers", "log_tracker", "create_tracker"])
    );
  });
});
