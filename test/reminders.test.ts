// Due-time reminders: the pure decision (shared/reminder) and the cron sweep's
// DB effects (mark-once, user-scoped). Push transport is not under test; the
// sweep marks before pushing by design, and with no subscriptions it only marks.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { reminderDue } from "../src/shared/reminder";
import { sendDueReminders } from "../src/worker/lib/reminders";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";

const task = (over: Partial<Parameters<typeof reminderDue>[0]> = {}) => ({
  status: "todo",
  due_date: "2026-07-23",
  due_time: "15:00",
  reminder_sent_at: null,
  ...over,
});

describe("reminderDue (pure)", () => {
  const today = "2026-07-23";

  it("fires once the time passes, not before", () => {
    expect(reminderDue(task(), today, "14:59")).toBe(false);
    expect(reminderDue(task(), today, "15:00")).toBe(true);
    expect(reminderDue(task(), today, "18:30")).toBe(true);
  });

  it("never fires twice", () => {
    expect(reminderDue(task({ reminder_sent_at: "x" }), today, "16:00")).toBe(false);
  });

  it("date-only tasks are the brief's job, not a reminder", () => {
    expect(reminderDue(task({ due_time: null }), today, "16:00")).toBe(false);
  });

  it("only today's tasks fire (yesterday's missed time stays silent)", () => {
    expect(reminderDue(task({ due_date: "2026-07-22" }), today, "16:00")).toBe(false);
    expect(reminderDue(task({ due_date: "2026-07-24" }), today, "16:00")).toBe(false);
  });

  it("done tasks never fire", () => {
    expect(reminderDue(task({ status: "done" }), today, "16:00")).toBe(false);
  });
});

describe("sendDueReminders (sweep)", () => {
  let raw: Db;
  let d1: TestD1;

  beforeEach(() => {
    ({ raw, d1 } = freshDb(MIGRATIONS));
    raw.exec(`INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com');`);
  });

  const env = () =>
    ({
      DB: d1,
      VAPID_PUBLIC_KEY: "test-key",
      VAPID_PRIVATE_KEY_JWK: "{}",
    }) as any;

  function seed(id: string, due_date: string, due_time: string | null, sent: string | null = null) {
    raw
      .prepare(
        `INSERT INTO tasks (id, user_id, title, status, due_date, due_time, reminder_sent_at)
         VALUES (?, ?, ?, 'todo', ?, ?, ?)`
      )
      .run(id, USER, id, due_date, due_time, sent);
  }

  const brusselsToday = () =>
    new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" }).slice(0, 10);

  it("marks a passed due-time task exactly once", async () => {
    seed("t1", brusselsToday(), "00:00"); // long past, whatever the hour
    const n1 = await sendDueReminders(env(), USER);
    expect(n1).toBe(1);
    const row = raw.prepare("SELECT reminder_sent_at FROM tasks WHERE id = 't1'").get() as any;
    expect(row.reminder_sent_at).toBeTruthy();
    // Second sweep: nothing new.
    expect(await sendDueReminders(env(), USER)).toBe(0);
  });

  it("leaves future times, date-only tasks and other users alone", async () => {
    seed("future", brusselsToday(), "23:59");
    seed("dateonly", brusselsToday(), null);
    raw.exec(`INSERT INTO users (id, email) VALUES ('user-b', 'b@example.com');`);
    raw
      .prepare(
        `INSERT INTO tasks (id, user_id, title, status, due_date, due_time)
         VALUES ('theirs', 'user-b', 'theirs', 'todo', ?, '00:01')`
      )
      .run(brusselsToday());
    const n = await sendDueReminders(env(), USER);
    expect(n).toBe(0);
    const theirs = raw.prepare("SELECT reminder_sent_at FROM tasks WHERE id = 'theirs'").get() as any;
    expect(theirs.reminder_sent_at).toBeNull();
  });

  it("does nothing when push is not configured", async () => {
    seed("t1", brusselsToday(), "00:00");
    expect(await sendDueReminders({ DB: d1 } as any, USER)).toBe(0);
  });
});
