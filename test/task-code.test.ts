// The short code, CB-142.
//
// A uuid cannot be said out loud or scanned for, so an agent quoting one makes a
// conversation about her own tasks unfollowable. These pin the two halves that
// have to agree: what gets printed, and what gets read back.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { freshDb, type Db } from "./d1-adapter";
import { taskCode, parseTaskCode, looksLikeTaskCode } from "../src/shared/taskCode";

describe("taskCode / parseTaskCode", () => {
  it("prints the form she reads", () => {
    expect(taskCode(142)).toBe("CB-142");
    expect(taskCode(1)).toBe("CB-1");
  });

  it("says nothing rather than CB-null for a task with no number", () => {
    expect(taskCode(null)).toBeNull();
    expect(taskCode(undefined)).toBeNull();
  });

  it("reads back every form she might type or paste", () => {
    // Typed mid-thought into a search box, or pasted out of a chat reply.
    for (const v of ["CB-142", "cb-142", "cb142", "CB 142", "#142", "142", " 142 "])
      expect(parseTaskCode(v), v).toBe(142);
  });

  it("refuses a title, so 'buy milk' searches instead of resolving", () => {
    for (const v of ["buy milk", "CB-", "CB-0", "-4", "12.5", "", null, "CB-1x"])
      expect(parseTaskCode(v as string), String(v)).toBeNull();
  });

  it("looksLikeTaskCode is the same question, asked where either is accepted", () => {
    expect(looksLikeTaskCode("CB-9")).toBe(true);
    expect(looksLikeTaskCode("9")).toBe(true);
    expect(looksLikeTaskCode("nine")).toBe(false);
  });
});

// The number itself comes from the database, not from any writer.
describe("seq assignment", () => {
  const MIGRATIONS = join(__dirname, "..", "migrations");
  const USER = "user-a";
  let raw: Db;

  beforeEach(() => {
    ({ raw } = freshDb(MIGRATIONS));
    raw.exec(`
      INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com'), ('user-b', 'b@example.com');
    `);
  });

  const add = (id: string, user = USER) =>
    raw
      .prepare("INSERT INTO tasks (id, user_id, title, status) VALUES (?, ?, ?, 'todo')")
      .run(id, user, id);
  const seqOf = (id: string) =>
    (raw.prepare("SELECT seq FROM tasks WHERE id = ?").get(id) as { seq: number }).seq;

  it("numbers every task without any writer asking it to", () => {
    // Seven code paths insert a task. Numbering them in code would be seven
    // chances to forget, and a task with no code cannot be referred to.
    add("a");
    add("b");
    expect(seqOf("a")).toBe(1);
    expect(seqOf("b")).toBe(2);
  });

  it("counts per user, so her numbering is hers alone", () => {
    add("a");
    add("theirs", "user-b");
    add("b");
    expect(seqOf("theirs")).toBe(1);
    expect(seqOf("b")).toBe(2);
  });

  it("never reuses a number after a deletion", () => {
    // CB-2 must not come back as a different task: the code is the task's name,
    // and she may have written it down somewhere.
    add("a");
    add("b");
    raw.prepare("DELETE FROM tasks WHERE id = 'b'").run();
    add("c");
    expect(seqOf("c")).toBe(3);
  });

  it("keeps the code a restored task already had", () => {
    // Undo should not rename a task. The trigger only fills a NULL.
    raw
      .prepare("INSERT INTO tasks (id, user_id, title, status, seq) VALUES ('r', ?, 'r', 'todo', 77)")
      .run(USER);
    expect(seqOf("r")).toBe(77);
  });

  it("refuses two tasks sharing a code", () => {
    add("a");
    expect(() =>
      raw
        .prepare("INSERT INTO tasks (id, user_id, title, status, seq) VALUES ('dup', ?, 'dup', 'todo', 1)")
        .run(USER)
    ).toThrow();
  });
});
