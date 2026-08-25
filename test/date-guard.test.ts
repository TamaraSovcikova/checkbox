// The "null" date incident, pinned at all three layers.
//
// What happened: the MCP connector typed due_date as a plain string while its
// description said "or null to clear", so a caller clearing a due date sent the
// four characters n-u-l-l and the column took them. date-fns v4 coerces with +,
// so +"null" is NaN, new Date(NaN) is Invalid Date, and format throws a
// RangeError mid-render. With no error boundary the whole route unmounted and
// the app went blank. About 50 tasks were affected. /backlog and /calendar
// survived only because neither formats those fields.
//
// Three layers now, each of which would have been enough on its own, which is
// the point: the writers reject it, the database refuses to store it, and the
// client renders around it.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { checkDate, checkDateFields, checkTime } from "../src/shared/dates";
import { tasks } from "../src/worker/routes/tasks";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const TOKEN = "tok-a";

describe("layer 1: the writers reject a non-date", () => {
  it('treats the STRINGS that mean "clear it" as null', () => {
    for (const v of ["null", "NULL", "", "  ", "undefined", "none", "-"])
      expect(checkDate(v)).toEqual({ ok: true, value: null });
    expect(checkDate(null)).toEqual({ ok: true, value: null });
    expect(checkDate(undefined)).toEqual({ ok: true, value: null });
  });

  it("keeps a real date, and the day out of a full ISO datetime", () => {
    expect(checkDate("2026-08-25")).toEqual({ ok: true, value: "2026-08-25" });
    expect(checkDate("2026-08-25T14:30:00Z")).toEqual({
      ok: true,
      value: "2026-08-25",
    });
  });

  it("REJECTS garbage rather than silently clearing it", () => {
    // The distinction that matters: "null" means "clear this", but "next friday"
    // means the caller got it wrong, and quietly turning a real deadline into no
    // deadline would trade a loud crash for an invisible loss.
    for (const v of ["next friday", "25/08/2026", "2026-8-5", "abcd-ef-gh"])
      expect(checkDate(v).ok).toBe(false);
  });

  it("rejects a day that does not exist, which the shape check would pass", () => {
    expect(checkDate("2026-02-31").ok).toBe(false);
    expect(checkDate("2026-13-01").ok).toBe(false);
    expect(checkDate("2028-02-29").ok).toBe(true); // a real leap day
  });

  it("covers every date-shaped field in one pass, and names the bad one", () => {
    const r = checkDateFields({
      title: "x",
      due_date: "null",
      planned_date: "2026-08-25",
      snoozed_until: "",
    });
    expect(r).toEqual({
      ok: true,
      value: {
        title: "x",
        due_date: null,
        planned_date: "2026-08-25",
        snoozed_until: null,
      },
    });
    const bad = checkDateFields({ blocked_until: "soon" });
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.error).toContain("blocked_until");
  });

  it("leaves a body with no dates completely alone", () => {
    const body = { title: "x", priority: 2 };
    expect(checkDateFields(body)).toEqual({ ok: true, value: body });
  });

  it("holds due_time to the same rule", () => {
    expect(checkTime("null")).toEqual({ ok: true, value: null });
    expect(checkTime("14:30")).toEqual({ ok: true, value: "14:30" });
    expect(checkTime("25:00").ok).toBe(false);
  });
});

describe("layer 1 end to end: the REST routes", () => {
  let raw: Db;
  let d1: TestD1;
  let app: Hono<any>;

  beforeEach(() => {
    ({ raw, d1 } = freshDb(MIGRATIONS));
    raw.exec(`
      INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com');
      INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN}', '${USER}');
      INSERT INTO tasks (id, user_id, title, status) VALUES ('t1', '${USER}', 'x', 'todo');
    `);
    app = new Hono();
    app.route("/", tasks);
  });

  // The route pushes to Google Calendar through waitUntil when a date changes.
  // Hono's executionCtx getter THROWS when there is none (optional chaining does
  // not save you from a throwing getter), so the test supplies one; a real
  // Worker always has it.
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

  const patch = (body: unknown) =>
    app.request(
      "/t1",
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
      { DB: d1 } as any,
      ctx
    );

  const stored = () =>
    raw.prepare("SELECT due_date FROM tasks WHERE id = 't1'").get() as {
      due_date: string | null;
    };

  it('stores SQL NULL, never the text "null", when a date is cleared', async () => {
    await patch({ due_date: "2026-08-25" });
    expect(stored().due_date).toBe("2026-08-25");
    const res = await patch({ due_date: "null" });
    expect(res.status).toBe(200);
    expect(stored().due_date).toBeNull();
  });

  it("400s on a date it cannot make sense of, and changes nothing", async () => {
    await patch({ due_date: "2026-08-25" });
    const res = await patch({ due_date: "sometime next week" });
    expect(res.status).toBe(400);
    expect(stored().due_date).toBe("2026-08-25");
  });
});

describe("layer 2: the database refuses to store one", () => {
  let raw: Db;

  beforeEach(() => {
    ({ raw } = freshDb(MIGRATIONS));
    raw.exec(`
      INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com');
      INSERT INTO tasks (id, user_id, title, status) VALUES ('t1', '${USER}', 'x', 'todo');
    `);
  });

  it("aborts an INSERT carrying a malformed date", () => {
    expect(() =>
      raw
        .prepare(
          "INSERT INTO tasks (id, user_id, title, status, due_date) VALUES ('t2', ?, 'y', 'todo', 'null')"
        )
        .run(USER)
    ).toThrow();
  });

  it("aborts an UPDATE carrying a malformed date, on every dated column", () => {
    for (const col of [
      "due_date",
      "planned_date",
      "snoozed_until",
      "blocked_until",
      "waiting_expected",
      "checkpoint_next",
      "recurrence_until",
    ]) {
      expect(() =>
        raw.prepare(`UPDATE tasks SET ${col} = 'null' WHERE id = 't1'`).run()
      ).toThrow();
    }
  });

  it("lets real dates and NULL through untouched", () => {
    raw
      .prepare("UPDATE tasks SET due_date = '2026-08-25', planned_date = NULL WHERE id = 't1'")
      .run();
    const row = raw
      .prepare("SELECT due_date, planned_date FROM tasks WHERE id = 't1'")
      .get() as { due_date: string; planned_date: null };
    expect(row.due_date).toBe("2026-08-25");
    expect(row.planned_date).toBeNull();
  });

  it("guards subtask and project dates too", () => {
    raw
      .prepare("INSERT INTO subtasks (id, task_id, title, done, position) VALUES ('s1','t1','s',0,0)")
      .run();
    expect(() =>
      raw.prepare("UPDATE subtasks SET due_date = 'null' WHERE id = 's1'").run()
    ).toThrow();
    expect(() =>
      raw
        .prepare(
          "INSERT INTO projects (id, user_id, name, due_date) VALUES ('p1', ?, 'p', 'null')"
        )
        .run(USER)
    ).toThrow();
  });
});
