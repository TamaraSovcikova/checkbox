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

// A task ticked off should leave the calendar. reconcileTaskEvents deletes the
// Google event, but it runs on the sync tick and can fail, so the read filters
// too - otherwise a done task keeps drawing an all-day chip. Prod had exactly
// one of these ("Prepare for team lunch", done, all-day row still cached).
describe("done tasks leave the calendar", () => {
  // Link a cached checkbox-owned event to a task in the given status.
  function ownedEvent(
    id: string,
    title: string,
    status: "todo" | "done",
    day = "2026-07-15",
    allDay = true
  ) {
    const taskId = `task-${id}`;
    raw
      .prepare(
        "INSERT INTO tasks (id, user_id, title, status, due_date) VALUES (?, ?, ?, ?, ?)"
      )
      .run(taskId, USER, title, status, day);
    raw
      .prepare(
        `INSERT INTO calendar_events_cache
           (id, user_id, gcal_event_id, calendar_id, title, start, end, all_day, is_checkbox_owned, task_id)
         VALUES (?, ?, ?, 'primary', ?, ?, ?, ?, 1, ?)`
      )
      .run(
        id,
        USER,
        `g-${id}`,
        title,
        allDay ? day : `${day}T08:00:00.000Z`,
        allDay ? day : `${day}T09:00:00.000Z`,
        allDay ? 1 : 0,
        taskId
      );
    return taskId;
  }

  it("hides an all-day event whose task is done, and keeps an open one", async () => {
    ownedEvent("e1", "Ticked off", "done");
    ownedEvent("e2", "Still open", "todo");

    const body = (await (await get("2026-07-15", "2026-07-16")).json()) as any[];
    const titles = body.map((e) => e.title);
    expect(titles).toContain("Still open");
    expect(titles).not.toContain("Ticked off");
  });

  it("hides a TIMED event whose task is done too", async () => {
    ownedEvent("e3", "Done time-block", "done", "2026-07-15", false);

    const body = (await (await get("2026-07-15", "2026-07-16")).json()) as any[];
    expect(body.map((e) => e.title)).not.toContain("Done time-block");
  });

  it("never hides a real Google event, even one linked to a done task", async () => {
    // is_checkbox_owned = 0: not ours to hide, whatever the task says.
    raw
      .prepare(
        "INSERT INTO tasks (id, user_id, title, status) VALUES ('t-ext', ?, 'Done', 'done')"
      )
      .run(USER);
    raw
      .prepare(
        `INSERT INTO calendar_events_cache
           (id, user_id, gcal_event_id, calendar_id, title, start, end, all_day, is_checkbox_owned, task_id)
         VALUES ('x1', ?, 'gx1', 'primary', 'Real meeting', '2026-07-15', '2026-07-16', 1, 0, 't-ext')`
      )
      .run(USER);

    const body = (await (await get("2026-07-15", "2026-07-16")).json()) as any[];
    expect(body.map((e) => e.title)).toContain("Real meeting");
  });
});
