// /api/export: everything the user owns, nothing anyone else owns.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { exportRoute } from "../src/worker/routes/export";

const MIGRATIONS = join(__dirname, "..", "migrations");

let raw: Db;
let d1: TestD1;
let app: Hono<any>;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('a', 'a@x.com'), ('b', 'b@x.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('tok-a', 'a');
    INSERT INTO areas (id, user_id, name) VALUES ('ar-a', 'a', 'Mine'), ('ar-b', 'b', 'Theirs');
    INSERT INTO tasks (id, user_id, title) VALUES ('t-a', 'a', 'my task'), ('t-b', 'b', 'their task');
    INSERT INTO subtasks (id, task_id, title) VALUES ('s-a', 't-a', 'my step'), ('s-b', 't-b', 'their step');
    INSERT INTO pins (id, user_id, kind) VALUES ('p-a', 'a', 'list');
    INSERT INTO trackers (id, user_id, name, created_at) VALUES ('tr-a', 'a', 'Mum', '2026-07-01'), ('tr-b', 'b', 'X', '2026-07-01');
    INSERT INTO tracker_events (id, user_id, tracker_id, occurred_at) VALUES ('e-a', 'a', 'tr-a', '2026-07-01'), ('e-b', 'b', 'tr-b', '2026-07-01');
  `);
  app = new Hono();
  app.route("/api/export", exportRoute);
});

describe("GET /api/export", () => {
  it("returns the caller's data across tables, and only theirs", async () => {
    const res = await app.request(
      "/api/export",
      { headers: { Authorization: "Bearer tok-a" } },
      { DB: d1 } as any
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body.format).toBe("checkbox-export-v1");
    expect(body.tasks.map((t: any) => t.id)).toEqual(["t-a"]);
    expect(body.areas.map((a: any) => a.id)).toEqual(["ar-a"]);
    expect(body.subtasks.map((s: any) => s.id)).toEqual(["s-a"]);
    expect(body.pins.map((p: any) => p.id)).toEqual(["p-a"]);
    expect(body.trackers.map((t: any) => t.id)).toEqual(["tr-a"]);
    expect(body.tracker_events.map((e: any) => e.id)).toEqual(["e-a"]);
    // Serialized whole: no table leaks user b anywhere.
    expect(JSON.stringify(body)).not.toContain("their");
  });

  it("rejects the unauthenticated", async () => {
    const res = await app.request("/api/export", {}, { DB: d1 } as any);
    expect(res.status).toBe(401);
  });
});
