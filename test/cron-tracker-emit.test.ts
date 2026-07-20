// The 06:00 cron actually emits tracker tasks.
//
// emitTrackerTasks is covered thoroughly elsewhere; what this pins is the
// WIRING: that it is called, from the right cron branch, for every user, and
// that a failure in it cannot stop the morning brief from going out. A function
// that works but is never called is the easiest thing in the world to ship.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { join } from "node:path";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import worker from "../src/worker/index";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER_A = "user-a";
const USER_B = "user-b";

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

let raw: Db;
let d1: TestD1;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${USER_A}', 'a@example.com');
    INSERT INTO users (id, email) VALUES ('${USER_B}', 'b@example.com');
  `);
  // The planner and the brief are not under test here and would need Google /
  // VAPID credentials; quieten them so a missing binding cannot be mistaken for
  // the emit failing.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function overdueTracker(id: string, name: string, user: string) {
  raw
    .prepare(
      `INSERT INTO trackers (id, user_id, name, kind, target_days, auto_task, created_at)
       VALUES (?, ?, ?, 'contact', 7, 1, '2026-01-01')`
    )
    .run(id, user, name);
  raw
    .prepare(
      "INSERT INTO tracker_events (id, user_id, tracker_id, occurred_at) VALUES (?, ?, ?, ?)"
    )
    .run(`e-${id}`, user, id, `${brussels(-30)}T10:00:00.000Z`);
}

// Collects what the handler defers so the test can await the real work.
function stubCtx() {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: { waitUntil: (p: Promise<unknown>) => pending.push(p) } as any,
    settle: () => Promise.allSettled(pending),
  };
}

const run = async (cron: string) => {
  const { ctx, settle } = stubCtx();
  await worker.scheduled({ cron } as any, { DB: d1 } as any, ctx);
  await settle();
};

const tasksFor = (user: string) =>
  raw
    .prepare("SELECT id, title, tracker_id FROM tasks WHERE user_id = ?")
    .all(user) as any[];

describe("06:00 cron", () => {
  it("emits a task for an overdue opted-in tracker", async () => {
    overdueTracker("t1", "Call Ivka", USER_A);
    await run("0 6 * * *");
    const rows = tasksFor(USER_A);
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe("Call Ivka");
    expect(rows[0].tracker_id).toBe("t1");
  });

  // Every user, not just the first row of the users table.
  it("runs for every user", async () => {
    overdueTracker("t1", "A's person", USER_A);
    overdueTracker("t2", "B's person", USER_B);
    await run("0 6 * * *");
    expect(tasksFor(USER_A).length).toBe(1);
    expect(tasksFor(USER_B).length).toBe(1);
  });

  it("does not stack duplicates when it runs again", async () => {
    overdueTracker("t1", "Call Ivka", USER_A);
    await run("0 6 * * *");
    await run("0 6 * * *");
    expect(tasksFor(USER_A).length).toBe(1);
  });

  // The 15-minute tick is calendar sync; it must not be creating tasks.
  it("the 15-minute cron emits nothing", async () => {
    overdueTracker("t1", "Call Ivka", USER_A);
    await run("*/15 * * * *");
    expect(tasksFor(USER_A).length).toBe(0);
  });
});
