// Deleting an email in Gmail should remove its still-pending coverage row, but
// leave rows a human already ruled on (filed/skipped, locked) and rows for other
// messages untouched.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { deletePendingByMessageId } from "../src/worker/lib/gmail";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";

let raw: Db;
let d1: TestD1;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com');`);
  const ins = raw.prepare(
    `INSERT INTO mail_candidates (id, user_id, source, thread_id, message_id, verdict, user_locked)
     VALUES (?, '${USER}', 'gmail_sync', ?, ?, ?, ?)`
  );
  ins.run("c1", "t1", "m1", "pending", 0); // trashed + pending  -> removed
  ins.run("c2", "t2", "m2", "pending", 0); // still alive         -> kept
  ins.run("c3", "t3", "m3", "filed", 1); // ruled on (locked)   -> kept
  ins.run("c4", "t4", "m4", "skipped", 1); // dismissed (locked)  -> kept
});

const has = (id: string) =>
  !!raw.prepare("SELECT 1 FROM mail_candidates WHERE id = ?").get(id);

describe("deletePendingByMessageId", () => {
  it("removes only pending, unlocked rows for trashed messages", async () => {
    // m1 and m3 and m4 were trashed in Gmail; m2 is still alive.
    const removed = await deletePendingByMessageId(d1 as any, USER, [
      "m1",
      "m3",
      "m4",
    ]);
    expect(removed).toBe(1); // only c1 (m1, pending, unlocked)
    expect(has("c1")).toBe(false);
    expect(has("c2")).toBe(true); // alive, never in trash set
    expect(has("c3")).toBe(true); // filed + locked stays
    expect(has("c4")).toBe(true); // skipped + locked stays
  });

  it("is a no-op when nothing matches", async () => {
    const removed = await deletePendingByMessageId(d1 as any, USER, ["nope"]);
    expect(removed).toBe(0);
    expect(has("c1")).toBe(true);
  });
});
