// Which Google events the sync sweeps away. This is the code that DELETES rows
// off a real calendar, so the selection rules are pinned here, away from the
// Google calls (findStrayTaskEvents is split out precisely so this can run).
//
// The safety property that matters: only events CHECKBOX made can ever be
// targeted (is_checkbox_owned = 1, set solely from our own checkbox_task_id tag,
// or the task's own linkage). A real calendar entry must never appear here.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { findStrayTaskEvents } from "../src/worker/lib/sync";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const CAL = "primary";

let raw: Db;
let d1: TestD1;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com');`);
});

// A task row. `link` is what tasks.gcal_event_id points at.
function task(
  id: string,
  status: "todo" | "done",
  link: string | null = null
) {
  raw
    .prepare(
      `INSERT INTO tasks (id, user_id, title, status, gcal_event_id, gcal_calendar_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, USER, `task ${id}`, status, link, link ? CAL : null);
}

// A cached event. `owned` = did Checkbox create it.
function cached(eventId: string, taskId: string | null, owned = true) {
  raw
    .prepare(
      `INSERT INTO calendar_events_cache
         (id, user_id, gcal_event_id, calendar_id, title, start, end, all_day, is_checkbox_owned, task_id)
       VALUES (?, ?, ?, ?, ?, '2026-07-17', '2026-07-18', 1, ?, ?)`
    )
    .run(`row-${eventId}`, USER, eventId, CAL, `event ${eventId}`, owned ? 1 : 0, taskId);
}

const strays = () => findStrayTaskEvents(d1 as any, USER, CAL);
const ids = async () => (await strays()).map((s) => s.eventId).sort();

describe("findStrayTaskEvents", () => {
  it("leaves an open task's event alone", async () => {
    task("t1", "todo", "ev1");
    cached("ev1", "t1");
    expect(await ids()).toEqual([]);
  });

  it("(a) sweeps a done task that still holds its linkage", async () => {
    task("t1", "done", "ev1");
    cached("ev1", "t1");
    expect(await ids()).toEqual(["ev1"]);
  });

  it("(b) sweeps a cached owned event whose task is gone", async () => {
    cached("ev1", null); // FK nulled task_id on delete
    expect(await ids()).toEqual(["ev1"]);
  });

  // The bug found in prod: complete NULLs the linkage, then the background delete
  // fails. (a) cannot see it (no linkage), (b) will not touch it (task exists).
  it("(c) sweeps a cached owned event whose task is done but linkage already cleared", async () => {
    task("t1", "done", null);
    cached("ev1", "t1");
    expect(await ids()).toEqual(["ev1"]);
  });

  // The second prod bug: one task, two owned events, task points at one of them.
  it("(d) sweeps a superseded duplicate, keeping the event the task points at", async () => {
    task("t1", "todo", "ev-keep");
    cached("ev-keep", "t1");
    cached("ev-stray", "t1");
    expect(await ids()).toEqual(["ev-stray"]);
  });

  it("does NOT clear the task's link when sweeping a superseded duplicate", async () => {
    task("t1", "todo", "ev-keep");
    cached("ev-keep", "t1");
    cached("ev-stray", "t1");
    const [s] = await strays();
    // Clearing here would abandon ev-keep and leave the task pointing at nothing.
    expect(s.eventId).toBe("ev-stray");
    expect(s.clearLink).toBe(false);
  });

  it("DOES clear the link when sweeping a done task's event", async () => {
    task("t1", "done", "ev1");
    cached("ev1", "t1");
    expect((await strays())[0].clearLink).toBe(true);
  });

  it("never touches an event Checkbox does not own, even with a done task", async () => {
    task("t1", "done", null);
    cached("ev-real", "t1", false); // a genuine Google entry
    expect(await ids()).toEqual([]);
  });

  it("reports each event once when several passes claim it", async () => {
    // Done task AND still linked AND cached: passes (a) and (c) both match.
    task("t1", "done", "ev1");
    cached("ev1", "t1");
    expect(await ids()).toEqual(["ev1"]);
  });

  it("ignores another user's strays", async () => {
    raw.exec(`INSERT INTO users (id, email) VALUES ('user-b', 'b@example.com');`);
    raw
      .prepare(
        `INSERT INTO tasks (id, user_id, title, status, gcal_event_id, gcal_calendar_id)
         VALUES ('t-b', 'user-b', 'theirs', 'done', 'ev-b', ?)`
      )
      .run(CAL);
    expect(await ids()).toEqual([]);
  });
});
