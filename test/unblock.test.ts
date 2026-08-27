// When the last blocker is ticked off, the task it was holding gets planned.
//
// Her problem: "those that are blocked, I always have to open the blocked tasks,
// read them, see when they are due, and then give an estimated date". Her first
// idea was to derive the date from the BLOCKER'S DUE DATE, and she doubted it
// herself. Rightly: a blocker due the 1st might be done on the 25th or the 8th,
// so that date is a forecast that looks identical to a decision, and nothing
// tells you when it goes stale.
//
// This derives from the completion instead, which already happened and so cannot
// be wrong. These tests pin the narrowness, because an automatic write to her
// data is only acceptable while it stays narrow and announced.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { planNewlyUnblocked } from "../src/worker/lib/unblock";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const OTHER = "user-b";
const TODAY = "2026-09-02";

let raw: Db;
let d1: TestD1;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com');
    INSERT INTO users (id, email) VALUES ('${OTHER}', 'b@example.com');
  `);
});

function task(
  id: string,
  over: {
    user?: string;
    status?: string;
    planned?: string | null;
    snoozed?: string | null;
    blockedUntil?: string | null;
    whenever?: number;
  } = {}
) {
  raw
    .prepare(
      `INSERT INTO tasks (id, user_id, title, status, planned_date, snoozed_until, blocked_until, whenever)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      over.user ?? USER,
      id,
      over.status ?? "todo",
      over.planned ?? null,
      over.snoozed ?? null,
      over.blockedUntil ?? null,
      over.whenever ?? 0
    );
}

// waiter is blocked by blocker.
function blocks(blocker: string, waiter: string) {
  raw
    .prepare(
      "INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)"
    )
    .run(waiter, blocker);
}

const done = (id: string) =>
  raw.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(id);

const plannedOf = (id: string) =>
  (
    raw.prepare("SELECT planned_date FROM tasks WHERE id = ?").get(id) as {
      planned_date: string | null;
    }
  ).planned_date;

const run = (completed: string) =>
  planNewlyUnblocked(d1 as any, USER, completed, TODAY);

describe("planNewlyUnblocked", () => {
  it("plans the waiting task for today, and names it back", async () => {
    task("blocker");
    task("waiter");
    blocks("blocker", "waiter");
    done("blocker");

    const freed = await run("blocker");
    expect(freed.map((t) => t.id)).toEqual(["waiter"]);
    expect(plannedOf("waiter")).toBe(TODAY);
  });

  it("does NOTHING while another blocker is still open", async () => {
    task("b1");
    task("b2");
    task("waiter");
    blocks("b1", "waiter");
    blocks("b2", "waiter");
    done("b1");

    await expect(run("b1")).resolves.toEqual([]);
    expect(plannedOf("waiter")).toBeNull();
  });

  it("fires once the LAST blocker goes", async () => {
    task("b1");
    task("b2");
    task("waiter");
    blocks("b1", "waiter");
    blocks("b2", "waiter");
    done("b1");
    await run("b1");
    done("b2");

    const freed = await run("b2");
    expect(freed.map((t) => t.id)).toEqual(["waiter"]);
    expect(plannedOf("waiter")).toBe(TODAY);
  });

  it("never overwrites a plan she already made", async () => {
    task("blocker");
    task("waiter", { planned: "2026-09-20" });
    blocks("blocker", "waiter");
    done("blocker");

    await expect(run("blocker")).resolves.toEqual([]);
    expect(plannedOf("waiter")).toBe("2026-09-20");
  });

  it("respects the explicit 'not yet' answers: snoozed and blocked-until", async () => {
    task("blocker");
    task("snoozed", { snoozed: "2026-09-30" });
    task("dated", { blockedUntil: "2026-09-30" });
    blocks("blocker", "snoozed");
    blocks("blocker", "dated");
    done("blocker");

    await expect(run("blocker")).resolves.toEqual([]);
    expect(plannedOf("snoozed")).toBeNull();
    expect(plannedOf("dated")).toBeNull();
  });

  it("never dates a `whenever` task, which is the one thing that flag means", async () => {
    task("blocker");
    task("someday", { whenever: 1 });
    blocks("blocker", "someday");
    done("blocker");

    await expect(run("blocker")).resolves.toEqual([]);
    expect(plannedOf("someday")).toBeNull();
  });

  it("skips a waiter that is already done", async () => {
    task("blocker");
    task("waiter", { status: "done" });
    blocks("blocker", "waiter");
    done("blocker");

    await expect(run("blocker")).resolves.toEqual([]);
  });

  it("never invents a DUE date, only a plan", async () => {
    task("blocker");
    task("waiter");
    blocks("blocker", "waiter");
    done("blocker");
    await run("blocker");

    const row = raw
      .prepare("SELECT due_date FROM tasks WHERE id = 'waiter'")
      .get() as { due_date: string | null };
    expect(row.due_date).toBeNull();
  });

  it("cannot reach another user's tasks", async () => {
    task("blocker");
    task("theirs", { user: OTHER });
    blocks("blocker", "theirs");
    done("blocker");

    await expect(run("blocker")).resolves.toEqual([]);
    expect(plannedOf("theirs")).toBeNull();
  });

  it("frees several waiters at once", async () => {
    task("blocker");
    task("w1");
    task("w2");
    blocks("blocker", "w1");
    blocks("blocker", "w2");
    done("blocker");

    const freed = await run("blocker");
    expect(freed.map((t) => t.id).sort()).toEqual(["w1", "w2"]);
  });
});
