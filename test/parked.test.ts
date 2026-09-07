// Parking: set aside deliberately, indefinitely, until something changes.
//
// She was already doing it by hand, once: "PARKED: writer website and portfolio
// (reopens only if the author path is ruled an income path)", marked optional
// and sitting in a normal area list with PARKED shouting at the top of it.
//
// The line that justifies its own view, and the thing these tests exist to
// protect: every other "not now" state either brings the task back on its own
// (snooze, blocked_until) or keeps it visible (waiting_on, optional). A parked
// task does NEITHER, so if it ever leaks into a working list the feature has
// failed, and if it is not in the Parked view it is lost.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { views } from "../src/worker/routes/views";
import { tasks as tasksRoute } from "../src/worker/routes/tasks";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const TOKEN = "tok-a";

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
let app: Hono<any>;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN}', '${USER}');
    INSERT INTO areas (id, user_id, name) VALUES ('area-1', '${USER}', 'Career');
  `);
  app = new Hono();
  app.route("/views", views);
  app.route("/tasks", tasksRoute);
});

function task(
  id: string,
  over: {
    due?: string | null;
    planned?: string | null;
    parked?: string | null;
    area?: string | null;
    whenever?: number;
    status?: string;
  } = {}
) {
  raw
    .prepare(
      `INSERT INTO tasks (id, user_id, title, status, due_date, planned_date, parked_at, area_id, whenever)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      USER,
      id,
      over.status ?? "todo",
      over.due ?? null,
      over.planned ?? null,
      over.parked ?? null,
      over.area ?? null,
      over.whenever ?? 0
    );
}

const get = async (path: string): Promise<string[]> => {
  const res = await app.request(
    path,
    { headers: { Authorization: `Bearer ${TOKEN}` } },
    { DB: d1 } as any
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as any[]).map((t) => t.id).sort();
};

const PARKED = "2026-05-01T09:00:00.000Z";

describe("a parked task leaves every working list", () => {
  it("is gone from Today, however it would otherwise qualify", async () => {
    task("due-today", { due: TODAY, parked: PARKED });
    task("planned-today", { planned: TODAY, parked: PARKED });
    task("still-here", { due: TODAY });
    await expect(get("/views/today")).resolves.toEqual(["still-here"]);
  });

  it("is gone from Upcoming, Overdue and the Backlog", async () => {
    task("soon", { due: brussels(3), parked: PARKED });
    task("late", { due: brussels(-3), parked: PARKED });
    task("loose", { parked: PARKED });
    await expect(get("/views/upcoming")).resolves.toEqual([]);
    await expect(get("/views/overdue")).resolves.toEqual([]);
    await expect(get("/views/backlog")).resolves.toEqual([]);
  });

  it("is gone from Whenever too: parking outranks every other not-now state", async () => {
    task("someday", { whenever: 1, parked: PARKED });
    task("active-someday", { whenever: 1 });
    await expect(get("/views/whenever")).resolves.toEqual(["active-someday"]);
  });

  it("is gone from an AREA list, which is where her hand-rolled one was stuck", async () => {
    task("parked-in-career", { area: "area-1", parked: PARKED });
    task("live-in-career", { area: "area-1" });
    await expect(get("/tasks?area_id=area-1")).resolves.toEqual(["live-in-career"]);
  });
});

describe("...and is findable in exactly two ways", () => {
  it("the Parked view, newest decision first", async () => {
    task("older", { parked: "2026-01-01T00:00:00.000Z" });
    task("newer", { parked: "2026-06-01T00:00:00.000Z" });
    const res = await app.request(
      "/views/parked",
      { headers: { Authorization: `Bearer ${TOKEN}` } },
      { DB: d1 } as any
    );
    const ids = ((await res.json()) as any[]).map((t) => t.id);
    expect(ids).toEqual(["newer", "older"]);
  });

  it("by id, so the sheet can still read a task back after parking it", async () => {
    task("p", { parked: PARKED });
    await expect(get("/tasks?ids=p")).resolves.toEqual(["p"]);
  });

  it("but never in the Parked view once it is actually done", async () => {
    task("finished", { parked: PARKED, status: "done" });
    await expect(get("/views/parked")).resolves.toEqual([]);
  });
});

describe("un-parking", () => {
  it("puts the task straight back where it belongs", async () => {
    task("back", { due: TODAY, parked: PARKED });
    await expect(get("/views/today")).resolves.toEqual([]);
    raw.prepare("UPDATE tasks SET parked_at = NULL WHERE id = 'back'").run();
    await expect(get("/views/today")).resolves.toEqual(["back"]);
  });
});
