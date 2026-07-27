// What /views/today actually returns. The client mirrors this rule in
// lib/today.ts, but THIS is the one that decides what you see, so the subtask
// clause is pinned here against a real database.
//
// Dates are computed from the route's own notion of today (Europe/Brussels), not
// hard-coded, so the suite cannot rot the way a literal "2026-07-05" did.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { views } from "../src/worker/routes/views";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const TOKEN = "tok-a";

// Mirror of the route's todayStr(): same zone, so seeds line up at any hour.
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

const TODAY = brussels(0);
const NEXT_MONTH = brussels(30);
const LAST_WEEK = brussels(-7);
const TOMORROW = brussels(1);

let raw: Db;
let d1: TestD1;
let app: Hono<any>;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN}', '${USER}');
  `);
  app = new Hono();
  app.route("/", views);
});

function task(id: string, over: { due?: string | null; status?: string } = {}) {
  raw
    .prepare(
      "INSERT INTO tasks (id, user_id, title, status, due_date) VALUES (?, ?, ?, ?, ?)"
    )
    .run(id, USER, id, over.status ?? "todo", over.due ?? null);
}

function subtask(
  id: string,
  taskId: string,
  due: string | null,
  done = false
) {
  raw
    .prepare(
      "INSERT INTO subtasks (id, task_id, title, done, position, due_date) VALUES (?, ?, ?, ?, 0, ?)"
    )
    .run(id, taskId, id, done ? 1 : 0, due);
}

const today = async (): Promise<string[]> => {
  const res = await app.request(
    "/today",
    { headers: { Authorization: `Bearer ${TOKEN}` } },
    { DB: d1 } as any
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as any[]).map((t) => t.id).sort();
};

const overdue = async (): Promise<string[]> => {
  const res = await app.request(
    "/overdue",
    { headers: { Authorization: `Bearer ${TOKEN}` } },
    { DB: d1 } as any
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as any[]).map((t) => t.id).sort();
};

describe("/views/today with subtasks", () => {
  it("pulls in a task whose SUBTASK is due today, though the task is not", () => {
    task("parent", { due: NEXT_MONTH });
    subtask("s1", "parent", TODAY);
    return expect(today()).resolves.toEqual(["parent"]);
  });

  it("does NOT pull in a task with an OVERDUE subtask: that is /overdue's job", async () => {
    // The EuroMeet lesson: overdue steps resurrected the parent in Today every
    // morning forever, surviving every Remove (which only snoozes a day).
    task("parent", { due: NEXT_MONTH });
    subtask("s1", "parent", LAST_WEEK);
    await expect(today()).resolves.toEqual([]);
    await expect(overdue()).resolves.toEqual(["parent"]);
  });

  it("/overdue ignores DONE past subtasks and future ones", async () => {
    task("a", { due: NEXT_MONTH });
    subtask("s1", "a", LAST_WEEK, true);
    task("b", { due: NEXT_MONTH });
    subtask("s2", "b", TOMORROW);
    await expect(overdue()).resolves.toEqual([]);
  });

  it("ignores a DONE subtask, however overdue", () => {
    task("parent", { due: NEXT_MONTH });
    subtask("s1", "parent", LAST_WEEK, true);
    return expect(today()).resolves.toEqual([]);
  });

  it("ignores a future or undated subtask", () => {
    task("a", { due: NEXT_MONTH });
    subtask("s1", "a", TOMORROW);
    task("b", { due: NEXT_MONTH });
    subtask("s2", "b", null);
    return expect(today()).resolves.toEqual([]);
  });

  it("does not resurrect a DONE task via its subtask", () => {
    task("parent", { due: NEXT_MONTH, status: "done" });
    subtask("s1", "parent", TODAY);
    return expect(today()).resolves.toEqual([]);
  });

  it("still returns tasks due today in their own right, and lists each once", () => {
    task("own", { due: TODAY });
    subtask("s1", "own", TODAY); // both reasons at once: must not duplicate
    task("neither", { due: NEXT_MONTH });
    return expect(today()).resolves.toEqual(["own"]);
  });

  it("hands the subtasks back on the task, so the row can name them", async () => {
    task("parent", { due: NEXT_MONTH });
    subtask("post the form", "parent", TODAY);
    const res = await app.request(
      "/today",
      { headers: { Authorization: `Bearer ${TOKEN}` } },
      { DB: d1 } as any
    );
    const [t] = (await res.json()) as any[];
    expect(t.subtasks.map((s: any) => s.due_date)).toEqual([TODAY]);
  });

  it("never reaches another user's subtasks", () => {
    raw.exec(`INSERT INTO users (id, email) VALUES ('user-b', 'b@example.com');`);
    raw
      .prepare(
        "INSERT INTO tasks (id, user_id, title, status, due_date) VALUES ('theirs', 'user-b', 'theirs', 'todo', ?)"
      )
      .run(NEXT_MONTH);
    subtask("s-b", "theirs", TODAY);
    return expect(today()).resolves.toEqual([]);
  });

  it("a snoozed task stays hidden even with a subtask due today", () => {
    task("parent", { due: NEXT_MONTH });
    subtask("s1", "parent", TODAY);
    raw
      .prepare("UPDATE tasks SET snoozed_until = ? WHERE id = 'parent'")
      .run(brussels(3));
    return expect(today()).resolves.toEqual([]);
  });
});

// A task you planned for today and did not finish must stay in Today when the
// day rolls over, rather than vanishing at midnight.
describe("/views/today carries an unfinished plan forward", () => {
  const planned = (id: string, day: string, status = "todo") =>
    raw
      .prepare(
        "INSERT INTO tasks (id, user_id, title, status, planned_date) VALUES (?, ?, ?, ?, ?)"
      )
      .run(id, USER, id, status, day);

  it("keeps a task planned for today", () => {
    planned("t", TODAY);
    return expect(today()).resolves.toEqual(["t"]);
  });

  it("keeps a task planned for an EARLIER day and still open", () => {
    planned("y", brussels(-1));
    planned("w", brussels(-7));
    return expect(today()).resolves.toEqual(["w", "y"]);
  });

  it("does NOT show a plan for a FUTURE day", () => {
    planned("tmrw", TOMORROW);
    return expect(today()).resolves.toEqual([]);
  });

  it("drops a carried-over plan once it is done", () => {
    planned("done", brussels(-2), "done");
    return expect(today()).resolves.toEqual([]);
  });

  it("still respects snooze on a carried-over plan", () => {
    planned("z", brussels(-3));
    raw.prepare("UPDATE tasks SET snoozed_until = ? WHERE id = 'z'").run(brussels(2));
    return expect(today()).resolves.toEqual([]);
  });
});

// A long-horizon task surfaces in Today on its checkpoint date, without being due.
describe("/views/today with checkpoints", () => {
  const withCheckpoint = (id: string, next: string | null, due = NEXT_MONTH) =>
    raw
      .prepare(
        "INSERT INTO tasks (id, user_id, title, status, due_date, checkpoint_days, checkpoint_next) VALUES (?, ?, ?, 'todo', ?, 14, ?)"
      )
      .run(id, USER, id, due, next);

  it("surfaces a task whose checkpoint is due today", () => {
    withCheckpoint("cp", TODAY);
    return expect(today()).resolves.toEqual(["cp"]);
  });

  it("surfaces one whose checkpoint is overdue", () => {
    withCheckpoint("cp", LAST_WEEK);
    return expect(today()).resolves.toEqual(["cp"]);
  });

  it("does NOT surface one whose checkpoint is still in the future", () => {
    withCheckpoint("cp", TOMORROW);
    return expect(today()).resolves.toEqual([]);
  });

  it("does NOT surface one with no pending checkpoint", () => {
    withCheckpoint("cp", null);
    return expect(today()).resolves.toEqual([]);
  });

  it("respects snooze on a due checkpoint", () => {
    withCheckpoint("cp", TODAY);
    raw.prepare("UPDATE tasks SET snoozed_until = ? WHERE id = 'cp'").run(brussels(3));
    return expect(today()).resolves.toEqual([]);
  });

  it("does not surface a done task even with a due checkpoint", () => {
    withCheckpoint("cp", TODAY);
    raw.prepare("UPDATE tasks SET status = 'done' WHERE id = 'cp'").run();
    return expect(today()).resolves.toEqual([]);
  });
});
