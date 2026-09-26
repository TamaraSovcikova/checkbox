// Today's Focus (#3), the storage half. Shared by the REST route and the MCP
// tool so both write focus the same way.

import { now } from "../db";

export type FocusResult = { ok: true; ids: string[] } | { ok: false; error: string };

// Replace today's focus with `ids`, in that order. An empty list clears it.
//
// Only the user's own open, unparked tasks can be focused. A focused task is
// also put in Today when it is not already there (planned for today unless it
// is planned earlier or due by today), since focusing on something that is not
// on today's list would be a contradiction the Today page cannot show.
export async function setFocus(
  db: D1Database,
  userId: string,
  ids: string[],
  today: string
): Promise<FocusResult> {
  const unique = [...new Set(ids)];
  if (unique.length) {
    const { results } = await db
      .prepare(
        `SELECT id FROM tasks WHERE user_id = ? AND status != 'done' AND parked_at IS NULL
           AND id IN (${unique.map(() => "?").join(",")})`
      )
      .bind(userId, ...unique)
      .all<{ id: string }>();
    const found = new Set((results ?? []).map((r) => r.id));
    const bad = unique.filter((id) => !found.has(id));
    if (bad.length) return { ok: false, error: `not an open task of yours: ${bad.join(", ")}` };
  }

  const stamp = now();
  const clear = db
    .prepare(
      "UPDATE tasks SET focus_date = NULL, focus_rank = NULL, updated_at = ? WHERE user_id = ? AND focus_date = ?"
    )
    .bind(stamp, userId, today);
  const set = db.prepare(
    `UPDATE tasks SET focus_date = ?, focus_rank = ?, updated_at = ?,
       planned_date = CASE
         WHEN planned_date IS NOT NULL AND planned_date <= ? THEN planned_date
         WHEN due_date IS NOT NULL AND due_date <= ? THEN planned_date
         ELSE ? END
     WHERE id = ? AND user_id = ?`
  );
  await db.batch([
    clear,
    ...unique.map((id, i) => set.bind(today, i + 1, stamp, today, today, today, id, userId)),
  ]);
  return { ok: true, ids: unique };
}

// Today's focus in order, and the open tasks from the most recent earlier focus
// day, which the Today page offers to carry over in one tap.
export async function getFocus(db: D1Database, userId: string, today: string) {
  const { results: current } = await db
    .prepare(
      `SELECT * FROM tasks WHERE user_id = ? AND focus_date = ? AND status != 'done'
         AND parked_at IS NULL ORDER BY focus_rank`
    )
    .bind(userId, today)
    .all<Record<string, unknown>>();
  const prev = await db
    .prepare(
      "SELECT MAX(focus_date) AS d FROM tasks WHERE user_id = ? AND focus_date < ?"
    )
    .bind(userId, today)
    .first<{ d: string | null }>();
  let carry: Record<string, unknown>[] = [];
  if (prev?.d && (current ?? []).length === 0) {
    const { results } = await db
      .prepare(
        `SELECT * FROM tasks WHERE user_id = ? AND focus_date = ? AND status != 'done'
           AND parked_at IS NULL ORDER BY focus_rank`
      )
      .bind(userId, prev.d)
      .all<Record<string, unknown>>();
    carry = results ?? [];
  }
  return { current: current ?? [], carry };
}
