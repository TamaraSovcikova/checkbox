// When the last blocker is ticked off, the task it was holding gets planned for
// today.
//
// Her problem, in her words: "those that are blocked, I always have to open the
// blocked tasks, read them, see when they are due, and then give an estimated
// date... it takes a lot of manual work". Her own first idea was to derive a
// blocked task's date from its blocker's DUE date, and she then doubted it. She
// was right to: a blocker due on the 1st might be finished on the 25th or the
// 8th, so the derived date is built on a prediction, it looks identical to a
// date she chose, and when the blocker slips nothing tells her it went stale.
// Dates you cannot trust are worse than no dates.
//
// This derives from something that ALREADY HAPPENED instead. At the moment the
// last blocker is completed, the waiting task is genuinely workable, and that is
// a fact rather than a forecast, so it cannot rot. It is also announced, which
// is the condition that makes an automatic write acceptable: the completion
// toast names what it just put on the plate.
//
// Deliberately narrow. It only touches a task that:
//   - has no plan of its own already (never overwrites her judgement),
//   - has no OTHER open blocker (one down is not unblocked),
//   - is not snoozed or date-blocked (both are explicit "not yet" answers),
//   - is not a `whenever` task (those never take a date, by definition),
//   - is not done.
// And it never touches a DUE date. A deadline is a commitment someone made; an
// unblocking is not the moment to invent one.
export async function planNewlyUnblocked(
  db: D1Database,
  userId: string,
  completedTaskId: string,
  // Passed in rather than computed: every route file already has its own
  // Brussels todayStr, and a seventh copy here would be one more place for the
  // timezone to drift.
  today: string
): Promise<{ id: string; title: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.title
         FROM tasks t
         JOIN task_dependencies d ON d.task_id = t.id
        WHERE d.depends_on_id = ?
          AND t.user_id = ?
          AND t.status != 'done'
          AND t.planned_date IS NULL
          AND t.whenever = 0
          AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?)
          AND (t.blocked_until IS NULL OR t.blocked_until <= ?)
          AND NOT EXISTS (
                SELECT 1 FROM task_dependencies d2
                  JOIN tasks b ON b.id = d2.depends_on_id
                 WHERE d2.task_id = t.id AND b.status != 'done'
              )`
    )
    .bind(completedTaskId, userId, today, today)
    .all<{ id: string; title: string }>();

  const freed = results ?? [];
  if (!freed.length) return [];

  const stamp = new Date().toISOString();
  await db.batch(
    freed.map((t) =>
      db
        .prepare(
          "UPDATE tasks SET planned_date = ?, updated_at = ? WHERE id = ? AND user_id = ?"
        )
        .bind(today, stamp, t.id, userId)
    )
  );
  return freed;
}
