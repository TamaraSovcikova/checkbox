// The two dates, as the server sees them.
//
// due_date is when a task is OWED; planned_date is the day I mean to work on
// it, and it moves around. planned_date has existed since migration 0010 but was
// writable only as "today" (the Add to Today button), so these cases could not
// arise before. They can now, and Upcoming is where a plan-only task would
// otherwise fall through the floor: not in Today until its day, not overdue, and
// not in the Backlog once it has an area.
//
// Dates come from the route's own notion of today (Europe/Brussels) so the suite
// cannot rot.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { views } from "../src/worker/routes/views";

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
const TOMORROW = brussels(1);
const NEXT_WEEK = brussels(7);
const NEXT_MONTH = brussels(30);
const LAST_WEEK = brussels(-7);

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

function task(
  id: string,
  over: { due?: string | null; planned?: string | null; status?: string } = {}
) {
  raw
    .prepare(
      "INSERT INTO tasks (id, user_id, title, status, due_date, planned_date) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(id, USER, id, over.status ?? "todo", over.due ?? null, over.planned ?? null);
}

const view = async (name: string): Promise<string[]> => {
  const res = await app.request(
    `/${name}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } },
    { DB: d1 } as any
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as any[]).map((t) => t.id);
};

describe("planned_date as a date in its own right", () => {
  it("Upcoming lists a task planned ahead with NO deadline", async () => {
    task("plan-only", { planned: NEXT_WEEK });
    await expect(view("upcoming")).resolves.toEqual(["plan-only"]);
  });

  it("a task planned ahead is NOT in Today until its day arrives", async () => {
    task("plan-only", { planned: TOMORROW });
    await expect(view("today")).resolves.toEqual([]);
  });

  it("a plan for today (or an unfinished older one) is in Today, not Upcoming", async () => {
    task("planned-today", { planned: TODAY });
    task("planned-and-missed", { planned: LAST_WEEK });
    await expect(view("today")).resolves.toEqual(
      expect.arrayContaining(["planned-today", "planned-and-missed"])
    );
    await expect(view("upcoming")).resolves.toEqual([]);
  });

  it("a task with BOTH dates is listed once in Upcoming, on its deadline", async () => {
    // The plan is nearer than the deadline, which is the normal case: work on it
    // next week, owe it next month. Ordering is by the DEADLINE, because that is
    // the date a forward-looking list is answering about.
    task("both", { due: NEXT_MONTH, planned: NEXT_WEEK });
    task("deadline-only", { due: TOMORROW });
    await expect(view("upcoming")).resolves.toEqual(["deadline-only", "both"]);
  });

  it("orders a plan-only task by its plan, among dated ones", async () => {
    task("due-later", { due: NEXT_MONTH });
    task("planned-sooner", { planned: TOMORROW });
    await expect(view("upcoming")).resolves.toEqual([
      "planned-sooner",
      "due-later",
    ]);
  });

  it("a done task is in neither view, however it is dated", async () => {
    task("finished", { planned: NEXT_WEEK, status: "done" });
    await expect(view("upcoming")).resolves.toEqual([]);
    await expect(view("today")).resolves.toEqual([]);
  });
});
