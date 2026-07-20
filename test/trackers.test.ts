// The /api/trackers routes against a real database. The derived fields (last_at,
// event_count) are computed in SQL, so they can only be trusted by running them.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { trackers } from "../src/worker/routes/trackers";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const TOKEN = "tok-a";
const OTHER = "user-b";
const OTHER_TOKEN = "tok-b";

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
  app.route("/", trackers);
});

const env = () => ({ DB: d1 }) as any;
const req = (path: string, init: RequestInit = {}, token = TOKEN) =>
  app.request(
    path,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    },
    env()
  );
const post = (p: string, body?: unknown, token = TOKEN) =>
  req(p, { method: "POST", body: body ? JSON.stringify(body) : undefined }, token);
const get = (p: string, token = TOKEN) => req(p, {}, token);

describe("trackers CRUD", () => {
  it("creates one and reports it as never logged", async () => {
    const res = await post("/", { name: "Ivka", target_days: 14 });
    expect(res.status).toBe(201);
    const t = (await res.json()) as any;
    expect(t.name).toBe("Ivka");
    expect(t.target_days).toBe(14);
    expect(t.last_at).toBeNull();
    expect(t.event_count).toBe(0);
    expect(t.archived).toBe(false);
  });

  it("rejects a nameless tracker", async () => {
    expect((await post("/", { name: "   " })).status).toBe(400);
  });

  // A zero or negative target would read as permanently overdue.
  it("treats a non-positive target as no target", async () => {
    const a = (await (await post("/", { name: "A", target_days: 0 })).json()) as any;
    const b = (await (await post("/", { name: "B", target_days: -3 })).json()) as any;
    expect(a.target_days).toBeNull();
    expect(b.target_days).toBeNull();
  });

  it("can be seeded with a past occurrence at creation", async () => {
    const t = (await (
      await post("/", { name: "Mum", last_at: "2026-07-01T10:00:00.000Z" })
    ).json()) as any;
    expect(t.last_at).toBe("2026-07-01T10:00:00.000Z");
    expect(t.event_count).toBe(1);
  });

  it("updates and archives", async () => {
    const t = (await (await post("/", { name: "Plants" })).json()) as any;
    const upd = (await (
      await req(`/${t.id}`, { method: "PATCH", body: JSON.stringify({ target_days: 7 }) })
    ).json()) as any;
    expect(upd.target_days).toBe(7);

    await req(`/${t.id}`, { method: "PATCH", body: JSON.stringify({ archived: true }) });
    // Archived drop out of the default list but are reachable deliberately.
    expect(((await (await get("/")).json()) as any[]).length).toBe(0);
    expect(((await (await get("/?archived=1")).json()) as any[]).length).toBe(1);
  });

  it("deletes the tracker and its history with it", async () => {
    const t = (await (await post("/", { name: "Gone" })).json()) as any;
    await post(`/${t.id}/log`);
    await req(`/${t.id}`, { method: "DELETE" });
    expect(((await (await get("/")).json()) as any[]).length).toBe(0);
    // The FK cascades, so no orphan events are left behind.
    const left = raw.prepare("SELECT COUNT(*) AS n FROM tracker_events").get() as any;
    expect(left.n).toBe(0);
  });
});

describe("logging", () => {
  it("logging sets last_at and bumps the count", async () => {
    const t = (await (await post("/", { name: "Ivka", target_days: 14 })).json()) as any;
    const res = await post(`/${t.id}/log`);
    expect(res.status).toBe(201);
    const { tracker: after, event_id } = (await res.json()) as any;
    expect(after.event_count).toBe(1);
    expect(after.last_at).not.toBeNull();
    expect(event_id).toBeTruthy();
  });

  it("accepts a backdated occurrence", async () => {
    const t = (await (await post("/", { name: "Ivka" })).json()) as any;
    const { tracker: after } = (await (
      await post(`/${t.id}/log`, { occurred_at: "2026-07-01T09:00:00.000Z" })
    ).json()) as any;
    expect(after.last_at).toBe("2026-07-01T09:00:00.000Z");
  });

  // last_at is MAX(occurred_at), not "the newest row", so logging a forgotten
  // older occurrence must not drag the counter backwards.
  it("keeps the LATEST occurrence when an older one is added afterwards", async () => {
    const t = (await (await post("/", { name: "Ivka" })).json()) as any;
    await post(`/${t.id}/log`, { occurred_at: "2026-07-15T09:00:00.000Z" });
    const { tracker: after } = (await (
      await post(`/${t.id}/log`, { occurred_at: "2026-07-02T09:00:00.000Z" })
    ).json()) as any;
    expect(after.last_at).toBe("2026-07-15T09:00:00.000Z");
    expect(after.event_count).toBe(2);
  });

  it("undo removes exactly the event it was given", async () => {
    const t = (await (await post("/", { name: "Ivka" })).json()) as any;
    await post(`/${t.id}/log`, { occurred_at: "2026-07-10T09:00:00.000Z" });
    const { event_id } = (await (
      await post(`/${t.id}/log`, { occurred_at: "2026-07-16T09:00:00.000Z" })
    ).json()) as any;

    const after = (await (
      await req(`/${t.id}/log/${event_id}`, { method: "DELETE" })
    ).json()) as any;
    // The older entry survives and becomes last_at again.
    expect(after.event_count).toBe(1);
    expect(after.last_at).toBe("2026-07-10T09:00:00.000Z");
  });

  it("returns the history newest first", async () => {
    const t = (await (await post("/", { name: "Ivka" })).json()) as any;
    await post(`/${t.id}/log`, { occurred_at: "2026-07-01T09:00:00.000Z" });
    await post(`/${t.id}/log`, { occurred_at: "2026-07-14T09:00:00.000Z" });
    const events = (await (await get(`/${t.id}/events`)).json()) as any[];
    expect(events.map((e) => e.occurred_at.slice(0, 10))).toEqual([
      "2026-07-14",
      "2026-07-01",
    ]);
  });
});

describe("isolation", () => {
  it("never lists another user's trackers", async () => {
    await post("/", { name: "Mine" });
    await post("/", { name: "Theirs" }, OTHER_TOKEN);
    const mine = (await (await get("/")).json()) as any[];
    expect(mine.map((t) => t.name)).toEqual(["Mine"]);
  });

  // Appending to a known id from another account must be impossible.
  it("refuses to log against someone else's tracker", async () => {
    const theirs = (await (await post("/", { name: "Theirs" }, OTHER_TOKEN)).json()) as any;
    expect((await post(`/${theirs.id}/log`)).status).toBe(404);
    const left = raw.prepare("SELECT COUNT(*) AS n FROM tracker_events").get() as any;
    expect(left.n).toBe(0);
  });

  it("cannot delete another user's tracker", async () => {
    const theirs = (await (await post("/", { name: "Theirs" }, OTHER_TOKEN)).json()) as any;
    await req(`/${theirs.id}`, { method: "DELETE" });
    const still = (await (await get("/", OTHER_TOKEN)).json()) as any[];
    expect(still.length).toBe(1);
  });
});
