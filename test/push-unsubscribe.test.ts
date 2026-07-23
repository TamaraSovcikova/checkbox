// DELETE /api/push/subscribe: with an endpoint it removes that one row; with no
// endpoint it removes ALL of the caller's subscriptions (what settings "Disable"
// means - the enabled label counts rows across every device, so clearing only
// the current browser's endpoint could leave the label stuck on "enabled").
// Another user's rows are never touched.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { push } from "../src/worker/routes/push";

const MIGRATIONS = join(__dirname, "..", "migrations");

const A = "user-a";
const B = "user-b";
const TOKEN_A = "tok-a";

let raw: Db;
let d1: TestD1;
let app: Hono<any>;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${A}', 'a@example.com'), ('${B}', 'b@example.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN_A}', '${A}');
    INSERT INTO push_subscriptions (id, user_id, endpoint, keys)
    VALUES ('s1', '${A}', 'https://push.example/a-laptop', '{}'),
           ('s2', '${A}', 'https://push.example/a-phone', '{}'),
           ('s3', '${B}', 'https://push.example/b-laptop', '{}');
  `);
  app = new Hono();
  app.route("/api/push", push);
});

const del = (body: unknown) =>
  app.request(
    "/api/push/subscribe",
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    { DB: d1 } as any
  );

const endpoints = (user: string) =>
  (
    raw
      .prepare("SELECT endpoint FROM push_subscriptions WHERE user_id = ? ORDER BY endpoint")
      .all(user) as { endpoint: string }[]
  ).map((r) => r.endpoint);

describe("DELETE /push/subscribe", () => {
  it("with an endpoint removes only that subscription", async () => {
    const res = await del({ endpoint: "https://push.example/a-laptop" });
    expect(res.status).toBe(200);
    expect(endpoints(A)).toEqual(["https://push.example/a-phone"]);
    expect(endpoints(B)).toHaveLength(1);
  });

  it("with no endpoint removes every subscription the caller has", async () => {
    const res = await del({});
    expect(res.status).toBe(200);
    expect(endpoints(A)).toEqual([]);
    // The other user's subscription survives.
    expect(endpoints(B)).toEqual(["https://push.example/b-laptop"]);
  });

  it("with no body at all still clears the caller's subscriptions", async () => {
    const res = await app.request(
      "/api/push/subscribe",
      { method: "DELETE", headers: { Authorization: `Bearer ${TOKEN_A}` } },
      { DB: d1 } as any
    );
    expect(res.status).toBe(200);
    expect(endpoints(A)).toEqual([]);
    expect(endpoints(B)).toHaveLength(1);
  });

  it("status reflects the cleared state", async () => {
    await del({});
    const res = await app.request(
      "/api/push/status",
      { headers: { Authorization: `Bearer ${TOKEN_A}` } },
      { DB: d1 } as any
    );
    const body = (await res.json()) as { subscriptions: number };
    expect(body.subscriptions).toBe(0);
  });
});
