// Per-calendar visibility: events from a calendar the user has toggled off must
// not come back from /events, the toggle endpoint flips it, and the primary
// calendar can't be hidden (it holds task events).

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { calendar } from "../src/worker/routes/calendar";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const TOKEN = "tok-a";

let raw: Db;
let d1: TestD1;
let app: Hono<any>;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN}', '${USER}');
    INSERT INTO calendar_feeds (user_id, calendar_id, summary, color, primary_cal, enabled) VALUES
      ('${USER}', 'primary', 'Me', '#111', 1, 1),
      ('${USER}', 'work@x', 'Work', '#222', 0, 1),
      ('${USER}', 'holidays@x', 'Holidays', '#333', 0, 0);
  `);
  const ins = raw.prepare(
    `INSERT INTO calendar_events_cache
       (id, user_id, gcal_event_id, calendar_id, title, start, end, all_day, is_checkbox_owned, task_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`
  );
  ins.run("e1", USER, "g1", "primary", "Standup", "2026-07-14T08:00:00.000Z", "2026-07-14T08:30:00.000Z", 0);
  ins.run("e2", USER, "g2", "work@x", "Work sync", "2026-07-14T09:00:00.000Z", "2026-07-14T09:30:00.000Z", 0);
  ins.run("e3", USER, "g3", "holidays@x", "Bank holiday", "2026-07-14", "2026-07-15", 1);
  app = new Hono();
  app.route("/", calendar);
});

const env = () => ({ DB: d1 }) as any;
const req = (path: string, init: RequestInit = {}) =>
  app.request(
    path,
    { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers || {}) } },
    env()
  );

describe("calendar feed visibility", () => {
  it("hides events from a disabled calendar", async () => {
    const res = await req("/events?start=2026-07-14&end=2026-07-15");
    const titles = ((await res.json()) as any[]).map((e) => e.title).sort();
    expect(titles).toEqual(["Standup", "Work sync"]); // no "Bank holiday"
  });

  it("re-enabling a calendar brings its events back", async () => {
    await req("/feeds/holidays@x", {
      method: "PATCH",
      body: JSON.stringify({ enabled: true }),
    });
    const res = await req("/events?start=2026-07-14&end=2026-07-15");
    const titles = ((await res.json()) as any[]).map((e) => e.title);
    expect(titles).toContain("Bank holiday");
  });

  it("disabling a calendar hides its events", async () => {
    await req("/feeds/work@x", {
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    });
    const res = await req("/events?start=2026-07-14&end=2026-07-15");
    const titles = ((await res.json()) as any[]).map((e) => e.title);
    expect(titles).not.toContain("Work sync");
  });

  it("refuses to hide the primary calendar", async () => {
    const res = await req("/feeds/primary", {
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(400);
    const enabled = (raw
      .prepare("SELECT enabled FROM calendar_feeds WHERE calendar_id = 'primary'")
      .get() as any).enabled;
    expect(enabled).toBe(1);
  });

  it("lists feeds with primary first", async () => {
    const res = await req("/feeds");
    const feeds = (await res.json()) as any[];
    expect(feeds[0].primary).toBe(true);
    expect(feeds.map((f) => f.enabled)).toContain(false);
  });
});
