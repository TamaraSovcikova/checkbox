import { Hono } from "hono";
import { type Bindings, getUserId } from "../db";

export const exportRoute = new Hono<{ Bindings: Bindings }>();

// GET /api/export: the user's complete data as one JSON document. Data
// ownership insurance: everything lives in one D1 database, so everything
// should be able to leave it in one request. Read-only, user-scoped.
//
// Two scoping shapes: most tables carry user_id; child tables (subtasks,
// task_labels, tracker logs, pin-less rows) scope through their parent.
const USER_TABLES = [
  "areas",
  "projects",
  "tasks",
  "labels",
  "saved_filters",
  "templates",
  "pins",
  "trackers",
  "day_plans",
  "note_candidates",
  "mail_candidates",
] as const;

exportRoute.get("/", async (c) => {
  const userId = await getUserId(c);
  const out: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    format: "checkbox-export-v1",
  };

  for (const table of USER_TABLES) {
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM ${table} WHERE user_id = ?`
    )
      .bind(userId)
      .all();
    out[table] = results ?? [];
  }

  const { results: sections } = await c.env.DB.prepare(
    `SELECT s.* FROM sections s JOIN projects p ON p.id = s.project_id WHERE p.user_id = ?`
  )
    .bind(userId)
    .all();
  out.sections = sections ?? [];

  const { results: subtasks } = await c.env.DB.prepare(
    `SELECT s.* FROM subtasks s JOIN tasks t ON t.id = s.task_id WHERE t.user_id = ?`
  )
    .bind(userId)
    .all();
  out.subtasks = subtasks ?? [];

  const { results: taskLabels } = await c.env.DB.prepare(
    `SELECT tl.* FROM task_labels tl JOIN tasks t ON t.id = tl.task_id WHERE t.user_id = ?`
  )
    .bind(userId)
    .all();
  out.task_labels = taskLabels ?? [];

  const { results: deps } = await c.env.DB.prepare(
    `SELECT d.* FROM task_dependencies d JOIN tasks t ON t.id = d.task_id WHERE t.user_id = ?`
  )
    .bind(userId)
    .all();
  out.task_dependencies = deps ?? [];

  const { results: trackerEvents } = await c.env.DB.prepare(
    `SELECT e.* FROM tracker_events e JOIN trackers tr ON tr.id = e.tracker_id WHERE tr.user_id = ?`
  )
    .bind(userId)
    .all();
  out.tracker_events = trackerEvents ?? [];

  c.header("Content-Disposition", `attachment; filename="checkbox-export.json"`);
  return c.json(out);
});
