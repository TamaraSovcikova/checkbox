import { rowToSubtask, rowToTask } from "../db";

// Attach labels + subtasks to a set of task rows in two batched queries.
export async function hydrateTasks(
  db: D1Database,
  rows: Record<string, unknown>[]
) {
  const tasks = rows.map(rowToTask);
  if (tasks.length === 0) return tasks;
  const ids = tasks.map((t) => t.id as string);
  const ph = ids.map(() => "?").join(",");

  const { results: labelRows } = await db
    .prepare(
      `SELECT tl.task_id, l.id, l.name, l.color
       FROM task_labels tl JOIN labels l ON l.id = tl.label_id
       WHERE tl.task_id IN (${ph})`
    )
    .bind(...ids)
    .all();

  const { results: subRows } = await db
    .prepare(`SELECT * FROM subtasks WHERE task_id IN (${ph}) ORDER BY position`)
    .bind(...ids)
    .all();

  const labelsByTask = new Map<string, unknown[]>();
  for (const r of labelRows as Record<string, unknown>[]) {
    const arr = labelsByTask.get(r.task_id as string) ?? [];
    arr.push({ id: r.id, name: r.name, color: r.color });
    labelsByTask.set(r.task_id as string, arr);
  }
  const subsByTask = new Map<string, unknown[]>();
  for (const r of subRows as Record<string, unknown>[]) {
    const arr = subsByTask.get(r.task_id as string) ?? [];
    arr.push(rowToSubtask(r));
    subsByTask.set(r.task_id as string, arr);
  }

  for (const t of tasks) {
    (t as Record<string, unknown>).labels = labelsByTask.get(t.id as string) ?? [];
    (t as Record<string, unknown>).subtasks = subsByTask.get(t.id as string) ?? [];
  }
  return tasks;
}
