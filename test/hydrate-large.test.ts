// Regression: Cloudflare D1 caps a query at 100 bound parameters. hydrateTasks
// builds `IN (?,?,…)` over every returned task id, so a user with >100 open
// tasks used to 500 the whole /api/tasks request ("too many SQL variables"),
// which emptied the calendar planner pane and the grid's task blocks. The
// hydrate now chunks the id list; this proves it works past the limit and still
// returns every task with its labels + subtasks intact.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { tasks } from "../src/worker/routes/tasks";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const TOKEN = "tok-a";
const N = 163; // matches the real account that surfaced the bug

let raw: Db;
let d1: TestD1;
let app: Hono<any>;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN}', '${USER}');
    INSERT INTO labels (id, user_id, name, color) VALUES ('lbl', '${USER}', 'focus', '#f00');
  `);
  const insTask = raw.prepare(
    `INSERT INTO tasks (id, user_id, title, status) VALUES (?, ?, ?, 'todo')`
  );
  const insSub = raw.prepare(
    `INSERT INTO subtasks (id, task_id, title, done, position) VALUES (?, ?, ?, 0, 0)`
  );
  const insTaskLabel = raw.prepare(
    `INSERT INTO task_labels (task_id, label_id) VALUES (?, 'lbl')`
  );
  for (let i = 0; i < N; i++) {
    const id = `t${i}`;
    insTask.run(id, USER, `Task ${i}`);
    insSub.run(`s${i}`, id, `sub ${i}`);
    insTaskLabel.run(id);
  }
  app = new Hono();
  app.route("/api/tasks", tasks);
});

const env = () => ({ DB: d1 }) as any;

describe("hydrateTasks past the D1 100-bind cap", () => {
  it("returns every open task with labels + subtasks", async () => {
    const res = await app.request(
      "/api/tasks",
      { headers: { Authorization: `Bearer ${TOKEN}` } },
      env()
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    expect(body).toHaveLength(N);
    // Every task must be hydrated, including ones beyond the first 100-id chunk.
    for (const t of body) {
      expect(t.subtasks).toHaveLength(1);
      expect(t.labels).toHaveLength(1);
      expect(t.labels[0].name).toBe("focus");
    }
  });
});
