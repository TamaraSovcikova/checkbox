// The "whenever" flag: things she means to do that will never carry a date.
//
// The flag exists to express a distinction nothing else could: a task with no
// date because it has not been scheduled YET, versus a task with no date
// because it never will be. Priority 4 ranks a commitment last; `optional` says
// she might not do it at all; a label says what it is about. None of those is
// this. These pin the two consequences that make the column worth its keep: its
// own pool, and staying out of the pile it would otherwise clutter.

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
const NEXT_WEEK = brussels(7);

let raw: Db;
let d1: TestD1;
let app: Hono<any>;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN}', '${USER}');
    INSERT INTO areas (id, user_id, name) VALUES ('area-1', '${USER}', 'Hobbies');
  `);
  app = new Hono();
  app.route("/", views);
});

function task(
  id: string,
  over: {
    whenever?: number;
    area?: string | null;
    status?: string;
    snoozed?: string | null;
    due?: string | null;
  } = {}
) {
  raw
    .prepare(
      `INSERT INTO tasks (id, user_id, title, status, whenever, area_id, snoozed_until, due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      USER,
      id,
      over.status ?? "todo",
      over.whenever ?? 0,
      over.area ?? null,
      over.snoozed ?? null,
      over.due ?? null
    );
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

describe("/views/whenever", () => {
  it("collects exactly the flagged tasks", async () => {
    task("someday", { whenever: 1 });
    task("ordinary");
    await expect(view("whenever")).resolves.toEqual(["someday"]);
  });

  it("keeps them out of the Backlog, which is the pile the flag rescues them from", async () => {
    task("someday", { whenever: 1 });
    task("unfiled");
    await expect(view("backlog")).resolves.toEqual(["unfiled"]);
  });

  it("shows them whether or not they are filed under an area", async () => {
    // Backlog is "unfiled"; Whenever is not about filing at all.
    task("filed", { whenever: 1, area: "area-1" });
    task("loose", { whenever: 1 });
    await expect(view("whenever")).resolves.toEqual(
      expect.arrayContaining(["filed", "loose"])
    );
  });

  it("respects done and snoozed like every other view", async () => {
    task("finished", { whenever: 1, status: "done" });
    task("hidden", { whenever: 1, snoozed: NEXT_WEEK });
    await expect(view("whenever")).resolves.toEqual([]);
  });

  it("does not pull a flagged task into Today or Upcoming on its own", async () => {
    task("someday", { whenever: 1 });
    await expect(view("today")).resolves.toEqual([]);
    await expect(view("upcoming")).resolves.toEqual([]);
  });

  it("a flagged task that somehow HAS a due date still behaves like a dated task", async () => {
    // The sheet clears dates when the flag is set, so this is a state she cannot
    // reach by hand. Pinned anyway: the views must not silently swallow a real
    // deadline just because a flag disagrees with it.
    task("odd", { whenever: 1, due: TODAY });
    await expect(view("today")).resolves.toEqual(["odd"]);
    await expect(view("whenever")).resolves.toEqual(["odd"]);
  });
});
