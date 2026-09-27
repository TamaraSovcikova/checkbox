// The app and the Claude connector read the SAME view (lib/viewSql).
//
// They used to keep separate copies and drifted: the connector's Today missed
// plans carried over from earlier days, due checkpoints and parents of steps due
// today; its Upcoming missed plan-only tasks and showed snoozed ones; its Overdue
// missed parents of overdue steps; its Backlog showed tasks planned for today.
// The data below hits each of those, and every view must list the same tasks.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { views } from "../src/worker/routes/views";
import { mcp } from "../src/worker/routes/mcp";
import { todayIn, addDaysIso } from "../src/shared/tz";

const T = todayIn("Europe/Brussels");
const D = (n: number) => addDaysIso(T, n);
const AUTH = { Authorization: "Bearer tok", "Content-Type": "application/json" };

let raw: Db;
let d1: TestD1;

beforeEach(() => {
  ({ raw, d1 } = freshDb(join(__dirname, "..", "migrations")));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('u', 'u@example.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('tok', 'u');
    INSERT INTO tasks (id, user_id, title, status, due_date, planned_date, snoozed_until, checkpoint_next) VALUES
      ('carried',    'u', 'Planned yesterday, not done', 'todo', NULL, '${D(-1)}', NULL, NULL),
      ('checkpoint', 'u', 'Checkpoint due',              'todo', '${D(60)}', NULL, NULL, '${D(0)}'),
      ('parent-now', 'u', 'Step due today',              'todo', '${D(30)}', NULL, NULL, NULL),
      ('parent-old', 'u', 'Step overdue',                'todo', '${D(30)}', NULL, NULL, NULL),
      ('plan-only',  'u', 'Planned next week, no due',   'todo', NULL, '${D(7)}', NULL, NULL),
      ('snoozed',    'u', 'Snoozed, due soon',           'todo', '${D(3)}', NULL, '${D(2)}', NULL),
      ('late',       'u', 'Overdue but snoozed',         'todo', '${D(-5)}', NULL, '${D(2)}', NULL),
      ('today-plan', 'u', 'Unfiled, planned today',      'todo', NULL, '${D(0)}', NULL, NULL);
    INSERT INTO subtasks (id, task_id, title, done, position, due_date) VALUES
      ('s1', 'parent-now', 'step', 0, 0, '${D(0)}'),
      ('s2', 'parent-old', 'step', 0, 0, '${D(-2)}');
  `);
});

async function appIds(view: string) {
  const res = await new Hono().route("/", views).request(`/${view}`, { headers: AUTH }, { DB: d1 } as any);
  return ((await res.json()) as { id: string }[]).map((t) => t.id).sort();
}

async function mcpIds(view: string) {
  const res = await new Hono().route("/", mcp).request(
    "/",
    {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_tasks", arguments: { view } },
      }),
    },
    { DB: d1 } as any
  );
  const body = (await res.json()) as any;
  const data = JSON.parse(body.result.content[0].text) as { tasks: { id: string }[] };
  return data.tasks.map((t) => t.id).sort();
}

describe("app and connector list the same tasks", () => {
  for (const view of ["today", "upcoming", "overdue", "backlog", "whenever", "parked", "snoozed", "logbook"]) {
    it(view, async () => {
      expect(await mcpIds(view)).toEqual(await appIds(view));
    });
  }

  it("and the cases that used to differ land where the app puts them", async () => {
    const today = await mcpIds("today");
    expect(today).toEqual(expect.arrayContaining(["carried", "checkpoint", "parent-now", "today-plan"]));
    expect(await mcpIds("upcoming")).toContain("plan-only");
    expect(await mcpIds("upcoming")).not.toContain("snoozed");
    expect(await mcpIds("overdue")).toContain("parent-old");
    expect(await mcpIds("overdue")).not.toContain("late");
    expect(await mcpIds("backlog")).not.toContain("today-plan");
  });
});
