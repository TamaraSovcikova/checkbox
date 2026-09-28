// The calendar sync writes an event only when it changed (2026-09-28).
//
// A full resync re-sends every event in the window, and rewriting identical rows
// was most of the database's daily writes, enough to hit D1's free limit. The
// statement is read from lib/sync.ts so this tests the real SQL.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { freshDb, type Db } from "./d1-adapter";

const src = readFileSync(join(__dirname, "..", "src", "worker", "lib", "sync.ts"), "utf8");
const UPSERT = src.match(/`(INSERT INTO calendar_events_cache\n\s+\(id, user_id, gcal_event_id, calendar_id, title, start, end, all_day, updated, is_checkbox_owned, task_id, color\)[\s\S]*?)`/)![1]
  .replace(/\\`/g, "`");

let raw: Db;
beforeEach(() => {
  ({ raw } = freshDb(join(__dirname, "..", "migrations")));
  raw.exec("INSERT INTO users (id, email) VALUES ('u', 'u@example.com')");
});

const write = (id: string, title: string, updated: string, color = "#111") =>
  raw.prepare(UPSERT).run(id, "u", "g1", "cal", title, "2026-10-01T09:00:00.000Z", "2026-10-01T10:00:00.000Z", 0, updated, 0, null, color).changes;

describe("calendar cache upsert", () => {
  it("inserts a new event", () => {
    expect(write("a", "Standup", "v1")).toBe(1);
  });

  it("writes nothing when Google sends the same event again", () => {
    write("a", "Standup", "v1");
    expect(write("b", "Standup", "v1")).toBe(0);
  });

  it("updates when the event changed on Google", () => {
    write("a", "Standup", "v1");
    expect(write("b", "Standup moved", "v2")).toBe(1);
    expect((raw.prepare("SELECT title FROM calendar_events_cache").get() as any).title).toBe("Standup moved");
  });

  it("updates when the calendar colour changed", () => {
    write("a", "Standup", "v1", "#111");
    expect(write("b", "Standup", "v1", "#222")).toBe(1);
  });
});
