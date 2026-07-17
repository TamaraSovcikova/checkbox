// Where a task lives: its area, and optionally a project inside that area.
//
// THE INVARIANT: if a task has a project, its area_id is that project's area_id.
// A project belongs to exactly one area, so a task in that project cannot
// meaningfully belong to another; the task sheet's section picker has always set
// both together and the UI reads task.area_id everywhere (tint, dot, grouping,
// filtering).
//
// Nothing enforced it. Any writer that set project_id alone left area_id NULL,
// chiefly the MCP tools (createOneTask inserts exactly the fields it is handed),
// which is how 53 of 194 tasks in a project ended up untinted and dot-coloured
// from the fallback accent, sitting next to 141 tinted ones. It read as the
// styling being random. Migration 0025 repaired those; this keeps them repaired.

/**
 * Force `body.area_id` to the project's area whenever the body sets a project.
 * Mutates and returns the body.
 *
 * - `project_id` set to a real id -> area_id becomes that project's area, whatever
 *   the caller said. There is no legitimate "project P but area Q", and letting a
 *   caller assert one is exactly how the drift happened.
 * - `project_id` explicitly null (moved to an area, or to the Backlog) -> left
 *   alone, so the caller's own area_id stands.
 * - `project_id` absent from the body -> left alone. A PATCH that only touches the
 *   title must not go rewriting where the task lives.
 *
 * The project is looked up scoped to the user, so a body naming someone else's
 * project cannot pull their area id across. (routes/tasks.ts also rejects such a
 * body outright in badRefs; this is the belt to that pair of braces.)
 */
export async function enforceProjectArea(
  db: D1Database,
  userId: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const projectId = body.project_id;
  if (typeof projectId !== "string" || !projectId) return body;

  const project = await db
    .prepare("SELECT area_id FROM projects WHERE id = ? AND user_id = ?")
    .bind(projectId, userId)
    .first<{ area_id: string | null }>();
  // Unknown project: leave the body untouched and let the caller's own validation
  // reject it, rather than silently nulling the area on the way past.
  if (!project) return body;

  body.area_id = project.area_id;
  return body;
}
