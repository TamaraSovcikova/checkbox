// Regression: the /api/calendar/events range query used to match all-day events
// with `start = ?` (the range-start date only), so in week view every all-day
// event except the ones starting on day one silently vanished. It now matches
// all-day starts across the whole [start, end) range like the timed branch.

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
  `);
  const ins = raw.prepare(
    `INSERT INTO calendar_events_cache
       (id, user_id, gcal_event_id, calendar_id, title, start, end, all_day, is_checkbox_owned, task_id)
     VALUES (?, ?, ?, 'primary', ?, ?, ?, ?, 0, NULL)`
  );
  // All-day events spread across the week (bare YYYY-MM-DD starts).
  ins.run("a1", USER, "g1", "Mon all-day", "2026-07-13", "2026-07-14", 1);
  ins.run("a2", USER, "g2", "Wed all-day", "2026-07-15", "2026-07-16", 1);
  ins.run("a3", USER, "g3", "Fri all-day", "2026-07-17", "2026-07-18", 1);
  // Outside the window.
  ins.run("a4", USER, "g4", "Next Mon all-day", "2026-07-20", "2026-07-21", 1);
  // A timed event mid-week (ISO start).
  ins.run(
    "t1", USER, "g5", "Thu meeting",
    "2026-07-16T08:00:00.000Z", "2026-07-16T09:00:00.000Z", 0
  );
});

const env = () => ({ DB: d1 }) as any;
const get = (start: string, end: string) =>
  app.request(
    `/events?start=${start}&end=${end}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } },
    env()
  );

beforeEach(() => {
  app = new Hono();
  app.route("/", calendar);
});

describe("calendar events range query", () => {
  it("returns every all-day event within the week, not just day one", async () => {
    const res = await get("2026-07-13", "2026-07-20");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    const titles = body.map((e) => e.title).sort();
    expect(titles).toEqual([
      "Fri all-day",
      "Mon all-day",
      "Thu meeting",
      "Wed all-day",
    ]);
    // The event starting on the exclusive end boundary is excluded.
    expect(titles).not.toContain("Next Mon all-day");
  });

  it("day view returns just that day's all-day event", async () => {
    const res = await get("2026-07-15", "2026-07-16");
    const body = (await res.json()) as any[];
    expect(body.map((e) => e.title)).toEqual(["Wed all-day"]);
  });
});
