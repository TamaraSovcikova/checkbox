// Trackers emitting real tasks, and the loop closing when you tick one off.
//
// The idempotency is the part that matters: a tracker that is overdue is overdue
// every day, so a naive version would stack a fresh duplicate every morning
// until you dealt with it.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import {
  emitTrackerTasks,
  shouldEmitTask,
  daysBetweenDays,
} from "../src/worker/lib/trackers";
import { emittedTaskTitle } from "../src/shared/tracker";
import { tasks as tasksRoute } from "../src/worker/routes/tasks";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const TOKEN = "tok-a";
const OTHER = "user-b";

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

let raw: Db;
let d1: TestD1;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com');
    INSERT INTO users (id, email) VALUES ('${OTHER}', 'b@example.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN}', '${USER}');
  `);
});

function tracker(
  id: string,
  name: string,
  opts: {
    target?: number | null;
    lastDaysAgo?: number | null;
    auto?: boolean;
    user?: string;
    areaId?: string | null;
    archived?: boolean;
    taskTitle?: string | null;
  } = {}
) {
  const {
    target = 7,
    lastDaysAgo = null,
    auto = true,
    user = USER,
    areaId = null,
    archived = false,
    taskTitle = null,
  } = opts;
  raw
    .prepare(
      `INSERT INTO trackers (id, user_id, name, kind, target_days, area_id, auto_task, archived, task_title, created_at)
       VALUES (?, ?, ?, 'contact', ?, ?, ?, ?, ?, '2026-01-01')`
    )
    .run(id, user, name, target, areaId, auto ? 1 : 0, archived ? 1 : 0, taskTitle);
  if (lastDaysAgo != null) {
    raw
      .prepare(
        "INSERT INTO tracker_events (id, user_id, tracker_id, occurred_at) VALUES (?, ?, ?, ?)"
      )
      .run(`e-${id}`, user, id, `${brussels(-lastDaysAgo)}T10:00:00.000Z`);
  }
}

const openTasks = () =>
  raw
    .prepare("SELECT id, title, tracker_id, due_date, status FROM tasks")
    .all() as any[];

describe("shouldEmitTask", () => {
  const base = { id: "t", name: "n", area_id: null, open_tasks: 0 };

  it("emits once past the target", () => {
    expect(
      shouldEmitTask({ ...base, target_days: 7, last_at: brussels(-7) }, TODAY)
    ).toBe(true);
    expect(
      shouldEmitTask({ ...base, target_days: 7, last_at: brussels(-6) }, TODAY)
    ).toBe(false);
  });

  it("emits for a targeted tracker that has never happened", () => {
    expect(shouldEmitTask({ ...base, target_days: 30, last_at: null }, TODAY)).toBe(true);
  });

  // A null target opted out of being late; it must never generate work.
  it("never emits without a target, however old", () => {
    expect(
      shouldEmitTask({ ...base, target_days: null, last_at: brussels(-400) }, TODAY)
    ).toBe(false);
    expect(shouldEmitTask({ ...base, target_days: null, last_at: null }, TODAY)).toBe(false);
  });

  // The anti-duplication rule.
  it("does not emit while an open task already exists", () => {
    expect(
      shouldEmitTask(
        { ...base, target_days: 7, last_at: brussels(-90), open_tasks: 1 },
        TODAY
      )
    ).toBe(false);
  });
});

describe("emitTrackerTasks", () => {
  it("creates a task due today, titled and filed like the tracker", async () => {
    raw.prepare("INSERT INTO areas (id, user_id, name) VALUES ('ar1', ?, 'People')").run(USER);
    tracker("t1", "Call Ivka", { target: 7, lastDaysAgo: 21, areaId: "ar1" });

    const created = await emitTrackerTasks(d1 as any, USER);
    expect(created.length).toBe(1);

    const [t] = openTasks();
    expect(t.title).toBe("Call Ivka");
    expect(t.tracker_id).toBe("t1");
    expect(t.due_date).toBe(TODAY);
    expect(t.status).toBe("todo");
    // Filed where the tracker is, so it lands in the right area's list.
    const row = raw.prepare("SELECT area_id FROM tasks WHERE id = ?").get(t.id) as any;
    expect(row.area_id).toBe("ar1");
  });

  it("names the task from the template, so the gauge can stay a noun", async () => {
    tracker("t1", "Ivka", { target: 7, lastDaysAgo: 21, taskTitle: "Call {name}" });
    await emitTrackerTasks(d1 as any, USER);
    expect(openTasks()[0].title).toBe("Call Ivka");
  });

  it("renaming the tracker changes what the NEXT task is called", async () => {
    tracker("t1", "Ivka", { target: 7, lastDaysAgo: 21, taskTitle: "Call {name}" });
    await emitTrackerTasks(d1 as any, USER);
    // Deal with the first one, rename, and let it fall behind again.
    raw.prepare("UPDATE tasks SET status = 'done' WHERE tracker_id = 't1'").run();
    raw.prepare("UPDATE trackers SET name = 'Ivka Novak' WHERE id = 't1'").run();
    await emitTrackerTasks(d1 as any, USER);
    const open = openTasks().filter((t) => t.status !== "done");
    expect(open[0].title).toBe("Call Ivka Novak");
  });

  // The one that would otherwise pile up a task a day forever.
  it("is idempotent while the emitted task is still open", async () => {
    tracker("t1", "Call Ivka", { target: 7, lastDaysAgo: 21 });
    await emitTrackerTasks(d1 as any, USER);
    await emitTrackerTasks(d1 as any, USER);
    await emitTrackerTasks(d1 as any, USER);
    expect(openTasks().length).toBe(1);
  });

  it("emits again once the previous task is done AND it is overdue again", async () => {
    tracker("t1", "Call Ivka", { target: 7, lastDaysAgo: 21 });
    await emitTrackerTasks(d1 as any, USER);
    // Tick it off WITHOUT logging the tracker, so it is still overdue.
    raw.prepare("UPDATE tasks SET status = 'done' WHERE tracker_id = 't1'").run();
    await emitTrackerTasks(d1 as any, USER);
    expect(openTasks().filter((t) => t.status !== "done").length).toBe(1);
    expect(openTasks().length).toBe(2);
  });

  it("skips trackers that are not opted in", async () => {
    tracker("t1", "Quiet", { target: 7, lastDaysAgo: 99, auto: false });
    expect((await emitTrackerTasks(d1 as any, USER)).length).toBe(0);
  });

  it("skips archived trackers", async () => {
    tracker("t1", "Old", { target: 7, lastDaysAgo: 99, archived: true });
    expect((await emitTrackerTasks(d1 as any, USER)).length).toBe(0);
  });

  it("skips ones that are still fresh", async () => {
    tracker("t1", "Recent", { target: 30, lastDaysAgo: 2 });
    expect((await emitTrackerTasks(d1 as any, USER)).length).toBe(0);
  });

  it("never touches another user's trackers", async () => {
    tracker("theirs", "Theirs", { target: 7, lastDaysAgo: 99, user: OTHER });
    expect((await emitTrackerTasks(d1 as any, USER)).length).toBe(0);
    expect(openTasks().length).toBe(0);
  });
});

describe("completing an emitted task logs the tracker", () => {
  let app: Hono<any>;
  beforeEach(() => {
    app = new Hono();
    app.route("/", tasksRoute);
  });

  const complete = (id: string, done = true) =>
    app.request(
      `/${id}/complete${done ? "" : "?done=0"}`,
      { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` } },
      { DB: d1 } as any
    );

  const events = () =>
    raw.prepare("SELECT id, tracker_id, task_id FROM tracker_events").all() as any[];

  it("ticking the task resets the gauge", async () => {
    tracker("t1", "Call Ivka", { target: 7, lastDaysAgo: 21 });
    const [taskId] = await emitTrackerTasks(d1 as any, USER);

    const res = await complete(taskId);
    expect(res.status).toBe(200);

    // The seeded event plus the one the completion created.
    const evs = events();
    expect(evs.length).toBe(2);
    const fromTask = evs.find((e) => e.task_id === taskId);
    expect(fromTask).toBeTruthy();
    expect(fromTask.tracker_id).toBe("t1");
  });

  it("re-opening the task removes exactly the event it created", async () => {
    tracker("t1", "Call Ivka", { target: 7, lastDaysAgo: 21 });
    const [taskId] = await emitTrackerTasks(d1 as any, USER);
    await complete(taskId);
    expect(events().length).toBe(2);

    await complete(taskId, false);
    const evs = events();
    expect(evs.length).toBe(1);
    // The original seeded occurrence survives; only the task's own event went.
    expect(evs[0].task_id).toBeNull();
  });

  it("a hand-pressed Log in between survives re-opening the task", async () => {
    tracker("t1", "Call Ivka", { target: 7, lastDaysAgo: 21 });
    const [taskId] = await emitTrackerTasks(d1 as any, USER);
    await complete(taskId);
    // Someone also pressed Log by hand: no task_id on that row.
    raw
      .prepare(
        "INSERT INTO tracker_events (id, user_id, tracker_id, occurred_at) VALUES ('manual', ?, 't1', ?)"
      )
      .run(USER, `${TODAY}T12:00:00.000Z`);

    await complete(taskId, false);
    const ids = events().map((e) => e.id);
    expect(ids).toContain("manual");
    expect(events().length).toBe(2); // seeded + manual
  });

  it("an ordinary task with no tracker is unaffected", async () => {
    raw
      .prepare(
        "INSERT INTO tasks (id, user_id, title, status) VALUES ('plain', ?, 'Plain', 'todo')"
      )
      .run(USER);
    const res = await complete("plain");
    expect(res.status).toBe(200);
    expect(events().length).toBe(0);
  });
});

describe("emittedTaskTitle", () => {
  it("falls back to the bare name when no template is set", () => {
    expect(emittedTaskTitle({ name: "Ivka", task_title: null })).toBe("Ivka");
    expect(emittedTaskTitle({ name: "Ivka", task_title: "   " })).toBe("Ivka");
  });

  it("interpolates {name}", () => {
    expect(emittedTaskTitle({ name: "Ivka", task_title: "Call {name}" })).toBe("Call Ivka");
    expect(
      emittedTaskTitle({ name: "the boiler", task_title: "Service {name} and log it" })
    ).toBe("Service the boiler and log it");
  });

  // The reason it is a template and not a stored literal.
  it("follows a rename", () => {
    const tpl = "Call {name}";
    expect(emittedTaskTitle({ name: "Ivka", task_title: tpl })).toBe("Call Ivka");
    expect(emittedTaskTitle({ name: "Ivka Novak", task_title: tpl })).toBe("Call Ivka Novak");
  });

  it("accepts a template with no placeholder at all", () => {
    expect(emittedTaskTitle({ name: "Ivka", task_title: "Ring home" })).toBe("Ring home");
  });

  it("replaces every occurrence, case-insensitively", () => {
    expect(emittedTaskTitle({ name: "Ivka", task_title: "{name}: message {NAME}" })).toBe(
      "Ivka: message Ivka"
    );
  });

  // Must never produce a nameless task.
  it("falls back rather than emitting an empty title", () => {
    expect(emittedTaskTitle({ name: "Ivka", task_title: "{name}" })).toBe("Ivka");
    expect(emittedTaskTitle({ name: "", task_title: "{name}" })).toBe("");
  });
});

describe("daysBetweenDays", () => {
  it("survives both Brussels DST boundaries", () => {
    expect(daysBetweenDays("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetweenDays("2026-10-24", "2026-10-26")).toBe(2);
  });
});
