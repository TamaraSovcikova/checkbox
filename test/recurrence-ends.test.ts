// Recurrence end conditions: the pure decision, and the two routes that apply
// it (complete rolls or finishes; skip-occurrence advances or ends).

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { rollDecision } from "../src/shared/recurrence";
import { tasks } from "../src/worker/routes/tasks";
import { resurrectRecurring } from "../src/worker/lib/resurrect";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const TOKEN = "tok-a";

describe("rollDecision (pure)", () => {
  it("rolls with no end conditions", () => {
    expect(rollDecision("2026-08-01", null, null)).toEqual({
      kind: "roll",
      due_date: "2026-08-01",
      recurrence_count: null,
    });
  });

  it("finishes past the until date, rolls on or before it", () => {
    expect(rollDecision("2026-08-01", "2026-07-31", null)).toEqual({ kind: "finish" });
    expect(rollDecision("2026-08-01", "2026-08-01", null).kind).toBe("roll");
  });

  it("counts down and finishes at one remaining", () => {
    expect(rollDecision("2026-08-01", null, 3)).toEqual({
      kind: "roll",
      due_date: "2026-08-01",
      recurrence_count: 2,
    });
    expect(rollDecision("2026-08-01", null, 1)).toEqual({ kind: "finish" });
  });

  it("finishes when the spec yields no next date", () => {
    expect(rollDecision(null, null, null)).toEqual({ kind: "finish" });
  });
});

describe("complete + skip with end conditions", () => {
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
    app.route("/api/tasks", tasks);
  });

  function seed(id: string, over: Record<string, unknown> = {}) {
    const base = {
      recurrence: "monthly",
      recurrence_mode: "fixed",
      due_date: "2026-07-20",
      recurrence_until: null,
      recurrence_count: null,
      ...over,
    };
    raw
      .prepare(
        `INSERT INTO tasks (id, user_id, title, status, recurrence, recurrence_mode,
           due_date, recurrence_until, recurrence_count)
         VALUES (?, ?, ?, 'todo', ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        USER,
        id,
        base.recurrence,
        base.recurrence_mode,
        base.due_date,
        base.recurrence_until,
        base.recurrence_count
      );
  }

  // The roll path fires a GCal push via c.executionCtx.waitUntil; Hono's getter
  // throws without one, so hand the request a stub.
  const ctx = () => ({ waitUntil: () => {}, passThroughOnException: () => {} }) as any;
  const post = (path: string) =>
    app.request(
      path,
      { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` } },
      { DB: d1 } as any,
      ctx()
    );

  const row = (id: string) =>
    raw
      .prepare(
        "SELECT status, due_date, recurrence, recurrence_count FROM tasks WHERE id = ?"
      )
      .get(id) as any;

  // Completion no longer rolls in place: it completes, and the next MORNING'S
  // sweep (lib/resurrect) wakes the task or ends the series. The walk-through
  // therefore alternates complete -> sweep, like real days do.
  const sweepNextMorning = async (day: string) => {
    // The sweep only wakes completions from BEFORE its day.
    raw.exec(`UPDATE tasks SET completed_at = '${day}T01:00:00.000Z'
              WHERE status = 'done' AND completed_at IS NOT NULL`);
    await resurrectRecurring({ DB: d1 } as any, day.slice(0, 10) < "9999" ? nextDay(day) : day);
  };
  const nextDay = (d: string) => {
    const dt = new Date(d + "T00:00:00Z");
    dt.setUTCDate(dt.getUTCDate() + 1);
    return dt.toISOString().slice(0, 10);
  };

  it("Audible case: monthly x3 completes, wakes, and ends after the third", async () => {
    seed("aud", { recurrence_count: 3 });

    let res = (await (await post("/api/tasks/aud/complete")).json()) as any;
    expect(res.recurred).toBe(false);
    expect(row("aud").status).toBe("done"); // rests crossed out today
    await sweepNextMorning("2026-07-20");
    expect(row("aud").status).toBe("todo"); // woken as occurrence 2
    expect(row("aud").recurrence_count).toBe(2);

    await post("/api/tasks/aud/complete");
    await sweepNextMorning("2026-08-20");
    expect(row("aud").status).toBe("todo"); // occurrence 3, the last
    expect(row("aud").recurrence_count).toBe(1);

    await post("/api/tasks/aud/complete");
    await sweepNextMorning("2026-09-20");
    const r = row("aud");
    expect(r.status).toBe("done"); // the series is over: stays done
    expect(r.recurrence).toBeNull();
  });

  it("until: the sweep after a completion past the horizon ends the series", async () => {
    seed("u", { recurrence_until: "2026-08-01" }); // next monthly = 08-20 > until
    const res = (await (await post("/api/tasks/u/complete")).json()) as any;
    expect(res.recurred).toBe(false);
    expect(row("u").status).toBe("done");
    await sweepNextMorning("2026-07-20");
    expect(row("u").status).toBe("done");
    expect(row("u").recurrence).toBeNull();
  });

  it("skip-occurrence advances the date without completing, consuming a count", async () => {
    seed("s", { recurrence_count: 2 });
    const res = (await (await post("/api/tasks/s/skip-occurrence")).json()) as any;
    expect(res.skipped).toBe(true);
    expect(res.ended).toBe(false);
    const r = row("s");
    expect(r.status).toBe("todo");
    expect(r.due_date).toBe("2026-08-20");
    expect(r.recurrence_count).toBe(1);
  });

  it("skipping the last occurrence ends the series, leaving the task open", async () => {
    seed("last", { recurrence_count: 1 });
    const res = (await (await post("/api/tasks/last/skip-occurrence")).json()) as any;
    expect(res.ended).toBe(true);
    const r = row("last");
    expect(r.status).toBe("todo");
    expect(r.recurrence).toBeNull();
  });

  it("skip on a non-recurring task is a 400", async () => {
    seed("plain", { recurrence: null });
    const res = await post("/api/tasks/plain/skip-occurrence");
    expect(res.status).toBe(400);
  });
});
