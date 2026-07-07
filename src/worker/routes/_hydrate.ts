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

  // Dependencies: blockers (this task waits on) and dependents (waiting on this).
  const { results: depRows } = await db
    .prepare(
      `SELECT d.task_id, d.depends_on_id, t.title, t.status
       FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on_id
       WHERE d.task_id IN (${ph})`
    )
    .bind(...ids)
    .all();
  const { results: blkRows } = await db
    .prepare(
      `SELECT d.depends_on_id AS blocker_id, d.task_id, t.title, t.status
       FROM task_dependencies d JOIN tasks t ON t.id = d.task_id
       WHERE d.depends_on_id IN (${ph})`
    )
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

  const depsByTask = new Map<string, unknown[]>();
  for (const r of depRows as Record<string, unknown>[]) {
    const arr = depsByTask.get(r.task_id as string) ?? [];
    arr.push({ id: r.depends_on_id, title: r.title, status: r.status });
    depsByTask.set(r.task_id as string, arr);
  }
  const blocksByTask = new Map<string, unknown[]>();
  for (const r of blkRows as Record<string, unknown>[]) {
    const arr = blocksByTask.get(r.blocker_id as string) ?? [];
    arr.push({ id: r.task_id, title: r.title, status: r.status });
    blocksByTask.set(r.blocker_id as string, arr);
  }

  for (const t of tasks) {
    (t as Record<string, unknown>).labels = labelsByTask.get(t.id as string) ?? [];
    (t as Record<string, unknown>).subtasks = subsByTask.get(t.id as string) ?? [];
    (t as Record<string, unknown>).depends_on = depsByTask.get(t.id as string) ?? [];
    (t as Record<string, unknown>).blocks = blocksByTask.get(t.id as string) ?? [];
  }
  return tasks;
}
