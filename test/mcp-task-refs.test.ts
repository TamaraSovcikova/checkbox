// How the connector NAMES a task, and what it accepts back.
//
// Her complaint: "the agent often references their ids when talking about them,
// which makes it hard for me to find and follow up on what we are talking on."
// True, and the cause was in the data, not the agent: the uuid was the only
// unique thing in the JSON, so it was the only thing there was to quote.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { mcp } from "../src/worker/routes/mcp";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const TOKEN = "tok-a";
const BASE = "https://checkbox.example.dev";

let raw: Db;
let d1: TestD1;
let app: Hono<any>;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN}', '${USER}');
    INSERT INTO tasks (id, user_id, title, status) VALUES
      ('uuid-one', '${USER}', 'Book the tickets', 'todo'),
      ('uuid-two', '${USER}', 'Renew the passport', 'todo');
  `);
  app = new Hono();
  app.route("/", mcp);
});

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const res = await app.request(
    "/",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    },
    { DB: d1, WORKER_URL: BASE } as any
  );
  return (await res.json()) as any;
}

const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await rpc("tools/call", { name, arguments: args })).result?.content?.[0]?.text as string;

describe("what the connector hands over", () => {
  it("gives every task a code and a link, not just a uuid", async () => {
    const out = await call("list_tasks", {});
    expect(out).toContain('"code": "CB-1"');
    expect(out).toContain(`"url": "${BASE}/task/CB-1"`);
  });

  it("links by CODE, so the link and the spoken name are the same string", async () => {
    // A link she can retype is worth more than a shorter one.
    const out = await call("get_task", { id: "uuid-one" });
    expect(out).toContain(`${BASE}/task/CB-1`);
    expect(out).not.toContain(`${BASE}/task/uuid-one`);
  });

  it("decorates a filter's results too, not only the task lists", async () => {
    raw
      .prepare(
        "INSERT INTO saved_filters (id, user_id, name, query, position) VALUES ('f', ?, 'All', '{}', 0)"
      )
      .run(USER);
    const out = await call("run_filter", { name: "All" });
    expect(out).toContain('"code": "CB-1"');
  });

  it("tells the client, at connect time, to use them and never the uuid", async () => {
    // The data alone would not fix this: a client quotes whatever looks like an
    // identifier unless told otherwise.
    const init = await rpc("initialize");
    const text = init.result.instructions as string;
    expect(text).toContain("CB-142");
    expect(text).toContain("markdown link");
    expect(text.toLowerCase()).toContain("never quote a task's uuid".toLowerCase());
  });
});

describe("what the connector accepts back", () => {
  it("acts on a code, so 'close CB-2' needs no lookup first", async () => {
    await call("complete_task", { id: "CB-2" });
    const row = raw
      .prepare("SELECT status FROM tasks WHERE id = 'uuid-two'")
      .get() as { status: string };
    expect(row.status).toBe("done");
  });

  it("takes the forms she might actually type", async () => {
    await call("update_task", { id: "cb1", title: "Renamed" });
    expect(
      (raw.prepare("SELECT title FROM tasks WHERE id = 'uuid-one'").get() as { title: string })
        .title
    ).toBe("Renamed");
  });

  it("still takes a uuid, so nothing that worked before changed", async () => {
    await call("update_task", { id: "uuid-one", title: "By uuid" });
    expect(
      (raw.prepare("SELECT title FROM tasks WHERE id = 'uuid-one'").get() as { title: string })
        .title
    ).toBe("By uuid");
  });

  it("resolves a code in the RELATIONSHIP fields too", async () => {
    await call("set_task_dependency", { task_id: "CB-1", depends_on_id: "CB-2" });
    const dep = raw
      .prepare("SELECT task_id, depends_on_id FROM task_dependencies")
      .get() as { task_id: string; depends_on_id: string };
    expect(dep).toEqual({ task_id: "uuid-one", depends_on_id: "uuid-two" });
  });

  it("says which code was wrong rather than failing vaguely", async () => {
    expect(await call("complete_task", { id: "CB-999" })).toContain("CB-999");
  });

  it("does not read an AREA's id as a task code", async () => {
    // update_area also takes an `id`, and it is not a task.
    raw
      .prepare("INSERT INTO areas (id, user_id, name) VALUES ('7', ?, 'Numbered')")
      .run(USER);
    await call("update_area", { id: "7", name: "Renamed area" });
    expect(
      (raw.prepare("SELECT name FROM areas WHERE id = '7'").get() as { name: string }).name
    ).toBe("Renamed area");
  });
});
