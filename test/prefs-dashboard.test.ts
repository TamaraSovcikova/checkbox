// The prefs whitelist filters in BOTH directions, so the dashboard layout has
// to survive a save/load roundtrip or the Home page silently loses its
// composition. Also pins the undefined-vs-empty distinction: never-customised
// (undefined, client renders the default) is not the same as emptied ([]).

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { prefs } from "../src/worker/routes/prefs";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const TOKEN = "tok-a";

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
  app.route("/", prefs);
});

const put = (body: unknown) =>
  app.request(
    "/",
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    { DB: d1 } as any
  );

const get = async () => {
  const res = await app.request(
    "/",
    { headers: { Authorization: `Bearer ${TOKEN}` } },
    { DB: d1 } as any
  );
  expect(res.status).toBe(200);
  return res.json() as Promise<any>;
};

describe("prefs dashboard roundtrip", () => {
  it("survives save and load, dropping what is malformed", async () => {
    const res = await put({
      hiddenViews: [],
      viewOrder: [],
      dashboard: [
        { widget: "today", x: 0, y: 0, w: 6, h: 4 },
        { widget: "starred", size: "S", config: { limit: 3 } },
        // A bad size is stripped but the widget survives (size is optional
        // since the free grid; unknown keys render a placeholder client-side).
        { widget: "odd", size: "XL" },
        { size: "M" }, // dropped: no widget
        "garbage", // dropped
        // Out-of-range coordinates are stripped field-by-field.
        { widget: "view:backlog", x: -2, y: 3, w: 99, h: 4 },
      ],
    });
    expect(res.status).toBe(200);
    const loaded = await get();
    expect(loaded.dashboard).toEqual([
      { widget: "today", x: 0, y: 0, w: 6, h: 4 },
      { widget: "starred", size: "S", config: { limit: 3 } },
      { widget: "odd" },
      { widget: "view:backlog", y: 3, h: 4 },
    ]);
  });

  it("undefined stays undefined; an emptied dashboard stays []", async () => {
    await put({ hiddenViews: [], viewOrder: [] });
    expect((await get()).dashboard).toBeUndefined();
    await put({ hiddenViews: [], viewOrder: [], dashboard: [] });
    expect((await get()).dashboard).toEqual([]);
  });
});
