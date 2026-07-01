// On-demand AI triage for backlog tasks.
// Uses keyword overlap heuristics to suggest area/project placement.
// The full Claude-powered triage lives in the MCP triage_backlog tool.

import { Hono } from "hono";
import { type Bindings, getUserId, uuid } from "../db";

export const triage = new Hono<{ Bindings: Bindings }>();

// POST /generate — score backlog tasks against areas+projects, store suggestions
triage.post("/generate", async (c) => {
  const userId = await getUserId(c);

  const { results: tasks } = await c.env.DB.prepare(
    `SELECT id, title FROM tasks
     WHERE user_id = ? AND area_id IS NULL AND project_id IS NULL AND status != 'done'
     ORDER BY priority, created_at LIMIT 50`
  )
    .bind(userId)
    .all<{ id: string; title: string }>();

  if (tasks.length === 0) return c.json([]);

  const { results: areas } = await c.env.DB.prepare(
    "SELECT id, name FROM areas WHERE user_id = ? AND archived_at IS NULL"
  )
    .bind(userId)
    .all<{ id: string; name: string }>();

  const { results: projects } = await c.env.DB.prepare(
    "SELECT id, name, area_id FROM projects WHERE user_id = ? AND status = 'active'"
  )
    .bind(userId)
    .all<{ id: string; name: string; area_id: string | null }>();

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
    const words = tokenize(task.title);

    let bestProject: (typeof projects)[0] | null = null;
    let bestProjectScore = 0;
    for (const p of projects) {
      const s = overlap(words, tokenize(p.name));
      if (s > bestProjectScore) { bestProjectScore = s; bestProject = p; }
    }

    let bestArea: (typeof areas)[0] | null = null;
    let bestAreaScore = 0;
    for (const a of areas) {
      const s = overlap(words, tokenize(a.name));
      if (s > bestAreaScore) { bestAreaScore = s; bestArea = a; }
    }

    // Prefer project > area when scores are equal
    const useProject = bestProject && bestProjectScore >= bestAreaScore;
    const chosenProject = useProject ? bestProject : null;
    const chosenArea = chosenProject
      ? areas.find((a) => a.id === chosenProject.area_id) ?? bestArea
      : bestArea;

    const confidence = useProject ? bestProjectScore : bestAreaScore;
    const destName = chosenProject?.name ?? chosenArea?.name ?? null;
    const reason =
      destName && confidence > 0
        ? `Keyword match with "${destName}"`
        : areas.length > 0 || projects.length > 0
        ? "No strong keyword match — please assign manually"
        : "Create areas or projects first, then re-triage";

    const id = uuid();
    await c.env.DB.prepare(
      `INSERT INTO triage_suggestions
         (id, task_id, suggested_area_id, suggested_project_id, confidence, reason)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        task.id,
        chosenArea?.id ?? null,
        chosenProject?.id ?? null,
        confidence,
        reason
      )
      .run();

    out.push({
      id,
      task_id: task.id,
      task_title: task.title,
      suggested_area_id: chosenArea?.id ?? null,
      suggested_project_id: chosenProject?.id ?? null,
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

// POST /:id/accept — apply suggestion to the task
triage.post("/:id/accept", async (c) => {
  const userId = await getUserId(c);
  const sugId = c.req.param("id");

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

  const ts = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE tasks SET area_id = ?, project_id = ?, updated_at = ? WHERE id = ?"
    ).bind(sug.suggested_area_id, sug.suggested_project_id, ts, sug.task_id),
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

// ── helpers ────────────────────────────────────────────────────────────────────

const STOP = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
  "one", "our", "out", "get", "has", "how", "its", "may", "new", "now",
  "see", "two", "who", "did", "let", "put", "say", "use", "add", "fix",
  "make", "with", "from", "that", "this", "have", "been", "will", "would",
  "could", "should", "some", "also", "when", "then", "just", "into",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function overlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const matches = a.filter((w) => setB.has(w)).length;
  return matches / Math.max(a.length, b.length);
}
