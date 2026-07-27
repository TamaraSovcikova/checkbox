// The /api/projects/reorder endpoint. It writes new positions straight to the
// DB, so the ordering it produces and the ownership scoping are pinned here.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { projects } from "../src/worker/routes/projects";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const TOKEN = "tok-a";
const OTHER = "user-b";
const OTHER_TOKEN = "tok-b";

let raw: Db;
let d1: TestD1;
let app: Hono<any>;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com');
    INSERT INTO users (id, email) VALUES ('${OTHER}', 'b@example.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN}', '${USER}');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('${OTHER_TOKEN}', '${OTHER}');
    INSERT INTO areas (id, user_id, name) VALUES ('ar', '${USER}', 'Area');
    INSERT INTO areas (id, user_id, name) VALUES ('ar-b', '${OTHER}', 'Their area');
  `);
  app = new Hono();
  app.route("/", projects);
});

function project(id: string, position: number, user = USER, area = "ar") {
  raw
    .prepare(
      "INSERT INTO projects (id, user_id, area_id, name, status, position) VALUES (?, ?, ?, ?, 'active', ?)"
    )
    .run(id, user, area, id, position);
}

const reorder = (items: { id: string; position: number }[], token = TOKEN) =>
  app.request(
    "/reorder",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(items),
    },
    { DB: d1 } as any
  );

const positions = (user = USER) =>
  (
    raw
      .prepare("SELECT id, position FROM projects WHERE user_id = ? ORDER BY position")
      .all(user) as any[]
  ).map((r) => `${r.id}:${r.position}`);

describe("POST /projects/reorder", () => {
  it("persists the new order", async () => {
    project("A", 0);
    project("B", 1);
    project("C", 2);
    const res = await reorder([
      { id: "B", position: 0 },
      { id: "C", position: 1 },
      { id: "A", position: 2 },
    ]);
    expect(res.status).toBe(200);
    expect(positions()).toEqual(["B:0", "C:1", "A:2"]);
  });

  it("does not touch another user's projects even if their id is in the payload", async () => {
    project("mine", 0);
    project("theirs", 0, OTHER, "ar-b");
    // Try to renumber the other user's project via this user's token.
    await reorder([{ id: "theirs", position: 9 }]);
    const theirs = raw
      .prepare("SELECT position FROM projects WHERE id = 'theirs'")
      .get() as any;
    expect(theirs.position).toBe(0); // unchanged
  });

  it("an empty payload is a no-op, not an error", async () => {
    project("A", 0);
    const res = await reorder([]);
    expect(res.status).toBe(200);
    expect(positions()).toEqual(["A:0"]);
  });
});

describe("PATCH /projects/:id starred", () => {
  it("stars and unstars, scoped to the owner", async () => {
    project("p1", 0);
    const star = (starred: number, token = TOKEN) =>
      app.request(
        "/p1",
        {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ starred }),
        },
        { DB: d1 } as any
      );
    let res = await star(1);
    expect(res.status).toBe(200);
    let row = raw.prepare("SELECT starred FROM projects WHERE id = 'p1'").get() as any;
    expect(row.starred).toBe(1);
    res = await star(0);
    expect(res.status).toBe(200);
    row = raw.prepare("SELECT starred FROM projects WHERE id = 'p1'").get() as any;
    expect(row.starred).toBe(0);
    // Another user cannot star someone else's project.
    res = await star(1, OTHER_TOKEN);
    row = raw.prepare("SELECT starred FROM projects WHERE id = 'p1'").get() as any;
    expect(row.starred).toBe(0);
  });
});
