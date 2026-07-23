// Pending mail-coverage rows EXPIRE once they age past the review window:
// they self-skip on list, so the queue opens near zero instead of growing
// into an unfinishable pile. User-locked decisions are never touched.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { mail } from "../src/worker/routes/mail";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const TOKEN = "tok-a";

const iso = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString();

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
  app.route("/api/mail", mail);
});

function seed(
  id: string,
  over: {
    received_at?: string | null;
    created_at?: string;
    verdict?: string;
    user_locked?: number;
  } = {}
) {
  raw
    .prepare(
      `INSERT INTO mail_candidates
         (id, user_id, source, thread_id, message_id, subject, received_at,
          verdict, user_locked, created_at, updated_at)
       VALUES (?, ?, 'planner', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      USER,
      `th-${id}`,
      `m-${id}`,
      `Subject ${id}`,
      over.received_at !== undefined ? over.received_at : iso(1),
      over.verdict ?? "pending",
      over.user_locked ?? 0,
      over.created_at ?? iso(1),
      iso(1)
    );
}

async function list() {
  const res = await app.request(
    "/api/mail/candidates",
    { headers: { Authorization: `Bearer ${TOKEN}` } },
    { DB: d1 } as any
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { id: string; verdict: string }[];
}

const verdictOf = (id: string) =>
  (raw.prepare("SELECT verdict, reason FROM mail_candidates WHERE id = ?").get(id) as any);

describe("mail coverage pending expiry", () => {
  it("keeps a pending row inside the window pending", async () => {
    seed("fresh", { received_at: iso(2) });
    const rows = await list();
    expect(rows.map((r) => r.id)).toContain("fresh");
    expect(verdictOf("fresh").verdict).toBe("pending");
  });

  it("expires a pending row older than the window to skipped, and drops it from the list", async () => {
    seed("stale", { received_at: iso(10), created_at: iso(10) });
    const rows = await list();
    expect(rows.map((r) => r.id)).not.toContain("stale");
    const v = verdictOf("stale");
    expect(v.verdict).toBe("skipped");
    expect(v.reason).toMatch(/expired/);
  });

  it("expires an undated pending row off created_at, so nothing lives forever", async () => {
    seed("undated", { received_at: null, created_at: iso(10) });
    await list();
    expect(verdictOf("undated").verdict).toBe("skipped");
  });

  it("shows an undated pending row while its created_at is recent", async () => {
    seed("undated-new", { received_at: null, created_at: iso(1) });
    const rows = await list();
    expect(rows.map((r) => r.id)).toContain("undated-new");
    expect(verdictOf("undated-new").verdict).toBe("pending");
  });

  it("never touches a user-locked row, however old", async () => {
    seed("locked", { received_at: iso(30), created_at: iso(30), user_locked: 1 });
    await list();
    expect(verdictOf("locked").verdict).toBe("pending");
  });

  it("never touches filed rows", async () => {
    seed("filed-old", { received_at: iso(30), created_at: iso(30), verdict: "filed" });
    await list();
    expect(verdictOf("filed-old").verdict).toBe("filed");
  });
});
