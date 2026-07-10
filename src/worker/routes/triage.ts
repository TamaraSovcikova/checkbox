// On-demand triage for backlog tasks.
//
// Scoring lives in `shared/triage.ts` and learns each destination's vocabulary
// from the tasks already filed there, so a title need not repeat the area name.
// When nothing clears the threshold we fall back to the user's chosen catch-all
// area (Settings > Triage), so an ad-hoc task still lands somewhere instead of
// being a dead end. The Claude-powered triage lives in the MCP triage_backlog tool.

import { Hono } from "hono";
import { type Bindings, getUserId, uuid } from "../db";
import {
  bestDestination,
  type TriageDest,
} from "../../shared/triage";

export const triage = new Hono<{ Bindings: Bindings }>();

type AreaRow = { id: string; name: string };
type ProjectRow = { id: string; name: string; area_id: string | null; description: string | null; goal: string | null };
type FiledTask = { title: string; notes: string | null; area_id: string | null; project_id: string | null };

// Read the user's catch-all area id out of the users.prefs JSON blob (no migration).
async function fallbackAreaId(env: Bindings, userId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT prefs FROM users WHERE id = ?")
    .bind(userId)
    .first<{ prefs: string | null }>();
  if (!row?.prefs) return null;
  try {
    const p = JSON.parse(row.prefs) as { triageFallbackAreaId?: string | null };
    return p.triageFallbackAreaId ?? null;
  } catch {
    return null;
  }
}

// POST /generate — score backlog tasks against areas+projects, store suggestions
triage.post("/generate", async (c) => {
  const userId = await getUserId(c);

  const { results: tasks } = await c.env.DB.prepare(
    `SELECT id, title, notes FROM tasks
     WHERE user_id = ? AND area_id IS NULL AND project_id IS NULL AND status != 'done'
     ORDER BY priority, created_at LIMIT 50`
  )
    .bind(userId)
    .all<{ id: string; title: string; notes: string | null }>();

  if (tasks.length === 0) return c.json([]);

  const [areasRes, projectsRes, filedRes] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id, name FROM areas WHERE user_id = ? AND archived_at IS NULL"
    ).bind(userId).all<AreaRow>(),
    c.env.DB.prepare(
      "SELECT id, name, area_id, description, goal FROM projects WHERE user_id = ? AND status = 'active'"
    ).bind(userId).all<ProjectRow>(),
    // Everything already filed: this is the training signal.
    c.env.DB.prepare(
      `SELECT title, notes, area_id, project_id FROM tasks
       WHERE user_id = ? AND (area_id IS NOT NULL OR project_id IS NOT NULL)
       ORDER BY created_at DESC LIMIT 500`
    ).bind(userId).all<FiledTask>(),
  ]);

  const areas = areasRes.results;
  const projects = projectsRes.results;
  const filed = filedRes.results;
  const fallbackId = await fallbackAreaId(c.env, userId);

  // Build one corpus per destination: its own text + the text of its filed tasks.
  const textFor = (pred: (t: FiledTask) => boolean) =>
    filed.filter(pred).map((t) => `${t.title} ${t.notes ?? ""}`).join(" ");

  const dests: TriageDest[] = [
    ...projects.map((p) => ({
      id: p.id,
      kind: "project" as const,
      name: p.name,
      areaId: p.area_id,
      corpus: `${p.name} ${p.description ?? ""} ${p.goal ?? ""} ${textFor((t) => t.project_id === p.id)}`,
    })),
    ...areas.map((a) => ({
      id: a.id,
      kind: "area" as const,
      name: a.name,
      areaId: a.id,
      // An area's vocabulary includes its loose tasks, its projects' names, and
      // the tasks inside those projects.
      corpus: [
        a.name,
        textFor((t) => t.area_id === a.id),
        projects.filter((p) => p.area_id === a.id).map((p) => p.name).join(" "),
        textFor((t) => projects.some((p) => p.area_id === a.id && p.id === t.project_id)),
      ].join(" "),
    })),
  ];

  // Clear stale pending suggestions for this user's backlog tasks
  await c.env.DB.prepare(
    `DELETE FROM triage_suggestions
     WHERE status = 'pending'
       AND task_id IN (
         SELECT id FROM tasks
         WHERE user_id = ? AND area_id IS NULL AND project_id IS NULL
       )`
  )
    .bind(userId)
    .run();

  const out = [];
  for (const task of tasks) {
    const best = bestDestination(task.title, task.notes, dests);

    let chosenProjectId: string | null = null;
    let chosenAreaId: string | null = null;
    let confidence = 0;
    let reason: string;

    if (best) {
      confidence = best.score;
      if (best.dest.kind === "project") {
        chosenProjectId = best.dest.id;
        chosenAreaId = best.dest.areaId;
      } else {
        chosenAreaId = best.dest.id;
      }
      const hits = best.matched.slice(0, 3).join(", ");
      reason = hits
        ? `Matches "${best.dest.name}" on: ${hits}`
        : `Matches "${best.dest.name}"`;
    } else if (fallbackId && areas.some((a) => a.id === fallbackId)) {
      chosenAreaId = fallbackId;
      const name = areas.find((a) => a.id === fallbackId)!.name;
      reason = `No strong match — filing to your catch-all area "${name}"`;
    } else if (areas.length === 0 && projects.length === 0) {
      reason = "Create areas or projects first, then re-triage";
    } else {
      reason = "No strong match — pick a destination below";
    }

    const chosenArea = areas.find((a) => a.id === chosenAreaId) ?? null;
    const chosenProject = projects.find((p) => p.id === chosenProjectId) ?? null;

    const id = uuid();
    await c.env.DB.prepare(
      `INSERT INTO triage_suggestions
         (id, task_id, suggested_area_id, suggested_project_id, confidence, reason)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(id, task.id, chosenAreaId, chosenProjectId, confidence, reason)
      .run();

    out.push({
      id,
      task_id: task.id,
      task_title: task.title,
      suggested_area_id: chosenAreaId,
      suggested_project_id: chosenProjectId,
      area_name: chosenArea?.name ?? null,
      project_name: chosenProject?.name ?? null,
      confidence,
      reason,
      status: "pending",
    });
  }

  return c.json(out);
});

// GET / — list current pending suggestions
triage.get("/", async (c) => {
  const userId = await getUserId(c);
  const { results } = await c.env.DB.prepare(
    `SELECT ts.id, ts.task_id, ts.suggested_area_id, ts.suggested_project_id,
            ts.confidence, ts.reason, ts.status,
            t.title  AS task_title,
            a.name   AS area_name,
            p.name   AS project_name
     FROM triage_suggestions ts
     JOIN tasks t  ON t.id = ts.task_id
     LEFT JOIN areas a    ON a.id = ts.suggested_area_id
     LEFT JOIN projects p ON p.id = ts.suggested_project_id
     WHERE t.user_id = ? AND ts.status = 'pending'
     ORDER BY ts.confidence DESC, ts.created_at`
  )
    .bind(userId)
    .all();
  return c.json(results);
});

// POST /:id/accept — apply the suggestion, or an explicit destination override
// from the card's picker (so a "no match" is still actionable in one click).
triage.post("/:id/accept", async (c) => {
  const userId = await getUserId(c);
  const sugId = c.req.param("id");

  const body = await c.req.json<{
    area_id?: string | null;
    project_id?: string | null;
  }>().catch(() => ({}) as { area_id?: string | null; project_id?: string | null });
  const override = "area_id" in body || "project_id" in body;

  const sug = await c.env.DB.prepare(
    `SELECT ts.task_id, ts.suggested_area_id, ts.suggested_project_id
     FROM triage_suggestions ts
     JOIN tasks t ON t.id = ts.task_id
     WHERE ts.id = ? AND t.user_id = ? AND ts.status = 'pending'`
  )
    .bind(sugId, userId)
    .first<{
      task_id: string;
      suggested_area_id: string | null;
      suggested_project_id: string | null;
    }>();

  if (!sug) return c.json({ error: "not found" }, 404);

  let areaId = override ? body.area_id ?? null : sug.suggested_area_id;
  const projectId = override ? body.project_id ?? null : sug.suggested_project_id;
  if (!areaId && !projectId) return c.json({ error: "no destination" }, 400);

  // Validate ownership, and derive the area from the project when only a project
  // was chosen (a task in a project always belongs to that project's area).
  if (projectId) {
    const p = await c.env.DB.prepare(
      "SELECT area_id FROM projects WHERE id = ? AND user_id = ?"
    )
      .bind(projectId, userId)
      .first<{ area_id: string | null }>();
    if (!p) return c.json({ error: "project not found" }, 400);
    areaId = p.area_id;
  } else if (areaId) {
    const a = await c.env.DB.prepare(
      "SELECT 1 FROM areas WHERE id = ? AND user_id = ?"
    )
      .bind(areaId, userId)
      .first();
    if (!a) return c.json({ error: "area not found" }, 400);
  }

  const ts = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE tasks SET area_id = ?, project_id = ?, updated_at = ? WHERE id = ?"
    ).bind(areaId, projectId, ts, sug.task_id),
    c.env.DB.prepare(
      "UPDATE triage_suggestions SET status = 'accepted' WHERE id = ?"
    ).bind(sugId),
  ]);

  return c.json({ ok: true });
});

// POST /:id/reject — mark suggestion rejected (task stays in backlog)
triage.post("/:id/reject", async (c) => {
  const userId = await getUserId(c);
  const sugId = c.req.param("id");

  await c.env.DB.prepare(
    `UPDATE triage_suggestions SET status = 'rejected'
     WHERE id = ?
       AND task_id IN (SELECT id FROM tasks WHERE user_id = ?)`
  )
    .bind(sugId, userId)
    .run();

  return c.json({ ok: true });
});

