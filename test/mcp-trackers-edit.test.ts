// Editing a cadence tracker over the connector.
//
// The connector could list, log and create trackers, and then not change one.
// That gap mattered most for `auto_task`, which decides whether a cadence going
// past due puts a task on her Today page: a setting with real consequences that
// only the app could touch.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { mcp } from "../src/worker/routes/mcp";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const TOKEN = "tok-a";

let raw: Db;
let d1: TestD1;
let app: Hono<any>;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com'), ('user-b', 'b@example.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN}', '${USER}');
    INSERT INTO trackers (id, user_id, name, target_days, auto_task, position, created_at)
      VALUES ('tr1', '${USER}', 'Ivka', 21, 0, 0, '2026-01-01');
    INSERT INTO trackers (id, user_id, name, position, created_at)
      VALUES ('tr-theirs', 'user-b', 'Not hers', 0, '2026-01-01');
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

const tracker = () =>
  raw.prepare("SELECT * FROM trackers WHERE id = 'tr1'").get() as Record<string, any>;

describe("update_tracker", () => {
  it("turns the auto-task on, which is the setting that has consequences", async () => {
    await call("update_tracker", { id: "tr1", auto_task: true, task_title: "Call {name}" });
    expect(tracker().auto_task).toBe(1);
    expect(tracker().task_title).toBe("Call {name}");
  });

  it("and off again", async () => {
    await call("update_tracker", { id: "tr1", auto_task: true });
    await call("update_tracker", { id: "tr1", auto_task: false });
    expect(tracker().auto_task).toBe(0);
  });

  it("renames and re-paces it", async () => {
    await call("update_tracker", { id: "tr1", name: "Ivka call", target_days: 14 });
    expect(tracker().name).toBe("Ivka call");
    expect(tracker().target_days).toBe(14);
  });

  it("treats null as a real value: clearing the target, not skipping the field", async () => {
    // A truthiness check would make "just count it, no cadence" unexpressible.
    await call("update_tracker", { id: "tr1", target_days: null });
    expect(tracker().target_days).toBeNull();
  });

  it("changes only what it was given", async () => {
    await call("update_tracker", { id: "tr1", name: "Renamed" });
    expect(tracker().target_days).toBe(21);
  });

  it("archives without deleting the history", async () => {
    await call("update_tracker", { id: "tr1", archived: true });
    expect(tracker().archived).toBe(1);
    expect(tracker().name).toBe("Ivka");
  });

  it("says so when there is nothing to change", async () => {
    expect(await call("update_tracker", { id: "tr1" })).toContain("No fields");
  });

  it("cannot touch another user's tracker", async () => {
    expect(await call("update_tracker", { id: "tr-theirs", name: "Hijacked" })).toContain(
      "not found"
    );
    const theirs = raw
      .prepare("SELECT name FROM trackers WHERE id = 'tr-theirs'")
      .get() as { name: string };
    expect(theirs.name).toBe("Not hers");
  });
});
