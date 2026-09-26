// Security fixes from the 2026-09-26 audit, pinned.
//
//   1. The Google connect callbacks never echo the query string into HTML
//      (a crafted `?error=<script>` link used to run inside the app).
//   2. A connect callback completes only with a one-time state this user
//      started for this flow (the state used to be the bare user id, unchecked).
//   3. The MCP "no auth configured" fallback exists only in local dev.
//   4. Uploaded files that are not on the safe list download instead of opening
//      as pages on our origin; links must be http(s).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { calendar } from "../src/worker/routes/calendar";
import { gmail } from "../src/worker/routes/gmail";
import { attachments } from "../src/worker/routes/attachments";
import { mcpUser } from "../src/worker/routes/mcp";
import { issueConnectState } from "../src/worker/lib/connect-state";
import { safeHttpUrl } from "../src/shared/url";
import { normalizeFlags } from "../src/shared/dates";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const OTHER = "user-b";
const AUTH = { Authorization: "Bearer tok-a" };

function fakeKV() {
  const m = new Map<string, string>();
  return {
    m,
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => void m.set(k, v),
    delete: async (k: string) => void m.delete(k),
  };
}

let raw: Db;
let d1: TestD1;
let kv: ReturnType<typeof fakeKV>;
let env: any;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com'), ('${OTHER}', 'b@example.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('tok-a', '${USER}');
  `);
  kv = fakeKV();
  env = {
    DB: d1,
    SESSIONS: kv,
    GOOGLE_CLIENT_ID: "cid",
    GOOGLE_CLIENT_SECRET: "secret",
    CALENDAR_ENCRYPTION_KEY: "0".repeat(64),
    WORKER_URL: "https://checkbox.example.com",
  };
});

afterEach(() => vi.restoreAllMocks());

const app = (route: Hono<any>) => new Hono().route("/", route);

describe("connect callbacks never reflect input", () => {
  for (const [name, route] of [["calendar", calendar], ["gmail", gmail]] as const) {
    it(`${name}: ?error= markup does not reach the page`, async () => {
      const res = await app(route).request(
        "/callback?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E",
        {},
        env
      );
      const body = await res.text();
      expect(res.status).toBe(400);
      expect(body).not.toContain("<script>");
      expect(body).not.toContain("alert(1)");
    });
  }
});

describe("connect state", () => {
  it("connect sends a random state, not the user id, and remembers it", async () => {
    const res = await app(calendar).request("/connect", { headers: AUTH }, env);
    expect(res.status).toBe(302);
    const state = new URL(res.headers.get("location")!).searchParams.get("state")!;
    expect(state).not.toBe(USER);
    expect(kv.m.has(`connectstate:${state}`)).toBe(true);
  });

  const cases: [string, () => Promise<string | undefined>][] = [
    ["no state", async () => undefined],
    ["an unknown state", async () => "made-up"],
    ["another user's state", () => issueConnectState(env, OTHER, "calendar")],
    ["a Gmail state on the calendar callback", () => issueConnectState(env, USER, "gmail")],
  ];
  for (const [label, make] of cases) {
    it(`refuses ${label} before talking to Google`, async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const state = await make();
      const q = new URLSearchParams({ code: "attacker-code", ...(state ? { state } : {}) });
      const res = await app(calendar).request(`/callback?${q}`, { headers: AUTH }, env);
      expect(res.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  it("accepts this user's own state once, then never again", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("no network in tests"));
    const state = await issueConnectState(env, USER, "calendar");
    const q = `/callback?code=c&state=${state}`;
    await app(calendar).request(q, { headers: AUTH }, env);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // got as far as the token exchange
    fetchSpy.mockClear();
    const replay = await app(calendar).request(q, { headers: AUTH }, env);
    expect(replay.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("MCP dev-open fallback", () => {
  it("is closed in production even with no secret and no tokens", async () => {
    raw.exec("DELETE FROM mcp_tokens");
    expect(await mcpUser({ DB: d1 } as any, undefined)).toBeNull();
  });

  it("still maps to the owner in local dev", async () => {
    raw.exec("DELETE FROM mcp_tokens");
    expect(await mcpUser({ DB: d1, DEV_AUTH_BYPASS: "1" } as any, undefined)).not.toBeNull();
  });
});

describe("links are http(s) only", () => {
  it("safeHttpUrl", () => {
    expect(safeHttpUrl("https://mail.google.com/x")).toBe("https://mail.google.com/x");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,hi")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });

  it("task writers drop a non-http permalink", () => {
    expect(normalizeFlags({ gmail_permalink: "javascript:alert(1)" }).gmail_permalink).toBeNull();
    expect(normalizeFlags({ title: "x" })).not.toHaveProperty("gmail_permalink");
  });

  it("link attachments refuse other schemes", async () => {
    raw.exec(`INSERT INTO tasks (id, user_id, title, status) VALUES ('t1', '${USER}', 'T', 'todo')`);
    const res = await app(attachments).request(
      "/t1/link",
      {
        method: "POST",
        headers: { ...AUTH, "Content-Type": "application/json" },
        body: JSON.stringify({ url: "javascript:alert(1)" }),
      },
      env
    );
    expect(res.status).toBe(400);
  });
});

describe("uploaded files", () => {
  function serve(type: string) {
    raw.exec(`
      INSERT INTO tasks (id, user_id, title, status) VALUES ('t1', '${USER}', 'T', 'todo');
      INSERT INTO attachments (id, task_id, kind, url, filename, size_bytes)
        VALUES ('a1', 't1', 'file', 'att/k', 'thing', 4);
    `);
    const r2 = {
      get: async () => ({
        body: "body",
        httpEtag: '"e"',
        writeHttpMetadata: (h: Headers) => h.set("content-type", type),
      }),
    };
    return app(attachments).request("/file/a1", { headers: AUTH }, { ...env, ATTACHMENTS: r2 });
  }

  it("HTML downloads, never renders", async () => {
    const res = await serve("text/html");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("SVG downloads too (it can carry script)", async () => {
    const res = await serve("image/svg+xml");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment/);
  });

  it("a PNG still opens inline, sandboxed", async () => {
    const res = await serve("image/png");
    expect(res.headers.get("content-disposition")).toMatch(/^inline/);
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
  });
});
