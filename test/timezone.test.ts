// Issue #5: "today" is the user's today, not Brussels'.
//
// The failure this pins: at 23:30 UK time it is already the next day in
// Brussels, so a UK user's Today list rolled over an hour early and due-time
// reminders fired an hour off.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { todayIn, hhmmIn, isValidTimeZone, addDaysIso, DEFAULT_TZ } from "../src/shared/tz";
import { todayFor, userTz } from "../src/worker/lib/tz";
import { views } from "../src/worker/routes/views";
import { prefs } from "../src/worker/routes/prefs";
import { resurrectRecurring } from "../src/worker/lib/resurrect";

const MIGRATIONS = join(__dirname, "..", "migrations");
// 22:30 UTC on 1 Oct = 23:30 in London (BST), 00:30 on 2 Oct in Brussels (CEST).
const LATE = new Date("2026-10-01T22:30:00.000Z");

describe("shared/tz", () => {
  it("gives each zone its own day at the boundary", () => {
    expect(todayIn("Europe/London", LATE)).toBe("2026-10-01");
    expect(todayIn("Europe/Brussels", LATE)).toBe("2026-10-02");
  });
  it("gives each zone its own clock", () => {
    expect(hhmmIn("Europe/London", LATE)).toBe("23:30");
    expect(hhmmIn("Europe/Brussels", LATE)).toBe("00:30");
  });
  it("falls back to the default for an unknown zone rather than throwing", () => {
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(todayIn("Mars/Olympus", LATE)).toBe(todayIn(DEFAULT_TZ, LATE));
  });
  it("adds days across a DST change without drifting", () => {
    expect(addDaysIso("2026-10-24", 2)).toBe("2026-10-26");
  });
});

describe("server: per-user today", () => {
  let raw: Db;
  let d1: TestD1;
  beforeEach(() => {
    ({ raw, d1 } = freshDb(MIGRATIONS));
    raw.exec(`
      INSERT INTO users (id, email, timezone) VALUES
        ('uk', 'uk@example.com', 'Europe/London'),
        ('be', 'be@example.com', 'Europe/Brussels'),
        ('bad', 'bad@example.com', 'Nowhere/Land');
      INSERT INTO mcp_tokens (token, user_id) VALUES ('tok-uk', 'uk');
    `);
  });
  afterEach(() => vi.useRealTimers());

  it("reads each user's zone, with a safe fallback", async () => {
    expect(await userTz(d1 as any, "uk")).toBe("Europe/London");
    expect(await userTz(d1 as any, "bad")).toBe(DEFAULT_TZ);
    expect(await todayFor(d1 as any, "uk", LATE)).toBe("2026-10-01");
    expect(await todayFor(d1 as any, "be", LATE)).toBe("2026-10-02");
  });

  it("Today for a UK user at 23:30 still shows what is planned for the UK day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(LATE);
    raw.exec(`
      INSERT INTO tasks (id, user_id, title, status, planned_date) VALUES
        ('tonight', 'uk', 'Tonight', 'todo', '2026-10-01'),
        ('tomorrow', 'uk', 'Tomorrow', 'todo', '2026-10-02');
    `);
    const app = new Hono().route("/", views);
    const res = await app.request("/today", { headers: { Authorization: "Bearer tok-uk" } }, { DB: d1 } as any);
    const ids = ((await res.json()) as any[]).map((t) => t.id);
    expect(ids).toContain("tonight");
    expect(ids).not.toContain("tomorrow");
  });

  it("the timezone endpoint validates and stores", async () => {
    const app = new Hono().route("/", prefs);
    const put = (tz: string) =>
      app.request(
        "/timezone",
        {
          method: "PUT",
          headers: { Authorization: "Bearer tok-uk", "Content-Type": "application/json" },
          body: JSON.stringify({ timezone: tz }),
        },
        { DB: d1 } as any
      );
    expect((await put("Mars/Olympus")).status).toBe(400);
    expect((await put("America/New_York")).status).toBe(200);
    expect(await userTz(d1 as any, "uk")).toBe("America/New_York");
  });

  it("the recurring sweep uses each user's own day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(LATE);
    // Both completed on 1 Oct. In Brussels that is yesterday, so it wakes; in
    // the UK it is still today, so it rests until the UK morning.
    raw.exec(`
      INSERT INTO tasks (id, user_id, title, status, recurrence, due_date, completed_at) VALUES
        ('uk-daily', 'uk', 'UK daily', 'done', 'daily', '2026-10-01', '2026-10-01T08:00:00.000Z'),
        ('be-daily', 'be', 'BE daily', 'done', 'daily', '2026-10-01', '2026-10-01T08:00:00.000Z');
    `);
    await resurrectRecurring({ DB: d1 } as any);
    const status = (id: string) =>
      (raw.prepare("SELECT status FROM tasks WHERE id = ?").get(id) as { status: string }).status;
    expect(status("be-daily")).toBe("todo");
    expect(status("uk-daily")).toBe("done");
  });
});
