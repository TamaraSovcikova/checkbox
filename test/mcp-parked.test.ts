// Parked tasks over the connector.
//
// Pinned separately from test/parked.test.ts because the MCP dispatch writes its
// OWN SQL for every view rather than calling routes/views. That duplication is
// not hypothetical: the first cut of parking patched the app's five view queries
// and missed the connector's copies, so a parked task vanished from her Today
// page and was still handed to an agent asking "what is on today". Caught by
// exercising the live endpoint, which is why this test exists.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { mcp } from "../src/worker/routes/mcp";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const TOKEN = "tok-a";

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
const TODAY = brussels(0);
const PARKED = "2026-05-01T09:00:00.000Z";

let raw: Db;
let d1: TestD1;
let app: Hono<any>;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN}', '${USER}');
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

const listed = async (view?: string) => {
  const text = await call("list_tasks", view ? { view } : {});
  return text;
};

function task(id: string, over: { due?: string; parked?: string } = {}) {
  raw
    .prepare(
      "INSERT INTO tasks (id, user_id, title, status, due_date, parked_at) VALUES (?, ?, ?, 'todo', ?, ?)"
    )
    .run(id, USER, id, over.due ?? null, over.parked ?? null);
}

describe("list_tasks and parked tasks", () => {
  beforeEach(() => {
    task("PARKED-TASK", { due: TODAY, parked: PARKED });
    task("LIVE-TASK", { due: TODAY });
  });

  it("keeps a parked task out of today, the exact case that leaked", async () => {
    const out = await listed("today");
    expect(out).toContain("LIVE-TASK");
    expect(out).not.toContain("PARKED-TASK");
  });

  it("keeps it out of overdue and upcoming too", async () => {
    task("PARKED-LATE", { due: brussels(-5), parked: PARKED });
    task("PARKED-SOON", { due: brussels(5), parked: PARKED });
    expect(await listed("overdue")).not.toContain("PARKED-LATE");
    expect(await listed("upcoming")).not.toContain("PARKED-SOON");
  });

  it("keeps it out of an UNFILTERED list, not only the named views", async () => {
    // The generic branch is the one an agent hits when it just asks for tasks.
    const out = await listed();
    expect(out).toContain("LIVE-TASK");
    expect(out).not.toContain("PARKED-TASK");
  });

  it("hands them over when the parked view is asked for by name", async () => {
    const out = await listed("parked");
    expect(out).toContain("PARKED-TASK");
    expect(out).not.toContain("LIVE-TASK");
  });

  it("get_task still answers for a parked task", async () => {
    // Parking hides a task from lists; it does not make it unreachable, or the
    // agent could not read one back after parking it.
    expect(await call("get_task", { id: "PARKED-TASK" })).toContain("PARKED-TASK");
  });
});

describe("parking over the connector", () => {
  it("parks with a reason, and un-parks", async () => {
    task("ROUNDTRIP", { due: TODAY });
    await call("update_task", {
      id: "ROUNDTRIP",
      parked_at: "2026-06-01T00:00:00.000Z",
      park_reason: "reopens if the pilot signs",
    });
    let row = raw
      .prepare("SELECT parked_at, park_reason FROM tasks WHERE id = 'ROUNDTRIP'")
      .get() as { parked_at: string | null; park_reason: string | null };
    expect(row.parked_at).toBe("2026-06-01T00:00:00.000Z");
    expect(row.park_reason).toBe("reopens if the pilot signs");
    expect(await listed("today")).not.toContain("ROUNDTRIP");

    await call("update_task", { id: "ROUNDTRIP", parked_at: null, park_reason: null });
    row = raw
      .prepare("SELECT parked_at, park_reason FROM tasks WHERE id = 'ROUNDTRIP'")
      .get() as { parked_at: string | null; park_reason: string | null };
    expect(row.parked_at).toBeNull();
    expect(await listed("today")).toContain("ROUNDTRIP");
  });
});
