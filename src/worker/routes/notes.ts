import { Hono } from "hono";
import { type Bindings, getUserId, uuid } from "../db";
import { candidateKey } from "../../shared/notes";
import { hydrateTasks } from "./_hydrate";

export const notes = new Hono<{ Bindings: Bindings }>();

export interface CandidateInput {
  title: string;
  source_path?: string | null;
  source_line?: number | null;
  kind?: "checkbox" | "todo" | "commitment";
  context?: string | null;
}

// Insert candidates, deduped by (user, path:line:title) so a re-scan never
// re-offers a line already pending/accepted/rejected. Returns how many were new.
// Shared by the /api/notes route and the scan_notes_for_tasks MCP tool.
export async function insertCandidates(
  db: D1Database,
  userId: string,
  candidates: CandidateInput[]
): Promise<number> {
  let added = 0;
  for (const c of candidates) {
    const title = (c.title ?? "").trim();
    if (!title) continue;
    const key = candidateKey(c.source_path, c.source_line, title);
    const res = await db
      .prepare(
        `INSERT OR IGNORE INTO note_candidates
           (id, user_id, title, source_path, source_line, kind, context, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        uuid(),
        userId,
        title,
        c.source_path ?? null,
        c.source_line ?? null,
        c.kind ?? "checkbox",
        c.context ?? null,
        key
      )
      .run();
    if (res.meta.changes > 0) added++;
  }
  return added;
}

// List pending candidates (the "From your notes" inbox).
notes.get("/candidates", async (c) => {
  const userId = await getUserId(c);
  const status = c.req.query("status") ?? "pending";
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM note_candidates WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 200"
  )
    .bind(userId, status)
    .all();
  return c.json(results);
});

// Bulk-insert candidates (used by the client paste box; MCP uses insertCandidates
// directly). Body: { candidates: [...] }.
notes.post("/candidates", async (c) => {
  const userId = await getUserId(c);
  const b = await c.req.json<{ candidates: CandidateInput[] }>();
  const added = await insertCandidates(c.env.DB, userId, b.candidates ?? []);
  return c.json({ ok: true, added });
});

// Accept a candidate → create a Backlog task carrying a source backlink in its
// notes, and mark the candidate accepted (kept, so it isn't re-offered).
notes.post("/candidates/:id/accept", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  const cand = await c.env.DB.prepare(
    "SELECT * FROM note_candidates WHERE id = ? AND user_id = ? AND status = 'pending'"
  )
    .bind(id, userId)
    .first<{
      title: string;
      source_path: string | null;
      source_line: number | null;
      context: string | null;
    }>();
  if (!cand) return c.json({ error: "not found" }, 404);

  const backlink = cand.source_path
    ? `From \`${cand.source_path}\`${cand.source_line ? ` · line ${cand.source_line}` : ""}`
    : null;
  const taskId = uuid();
  // Structured linkage, not just the notes backlink: this is what the vault
  // sync tools match on (shared/vault.ts).
  await c.env.DB.prepare(
    `INSERT INTO tasks (id, user_id, title, notes, priority,
       source_path, source_line, source_text)
     VALUES (?, ?, ?, ?, 4, ?, ?, ?)`
  )
    .bind(
      taskId,
      userId,
      cand.title,
      backlink,
      cand.source_path,
      cand.source_line,
      cand.context ?? null
    )
    .run();
  await c.env.DB.prepare(
    "UPDATE note_candidates SET status = 'accepted' WHERE id = ? AND user_id = ?"
  )
    .bind(id, userId)
    .run();

  const row = await c.env.DB.prepare("SELECT * FROM tasks WHERE id = ?")
    .bind(taskId)
    .first();
  const [task] = await hydrateTasks(c.env.DB, [row as Record<string, unknown>]);
  return c.json(task, 201);
});

notes.post("/candidates/:id/reject", async (c) => {
  const userId = await getUserId(c);
  await c.env.DB.prepare(
    "UPDATE note_candidates SET status = 'rejected' WHERE id = ? AND user_id = ?"
  )
    .bind(c.req.param("id"), userId)
    .run();
  return c.json({ ok: true });
});

// Clear all pending candidates (reject the lot).
notes.post("/candidates/reject-all", async (c) => {
  const userId = await getUserId(c);
  await c.env.DB.prepare(
    "UPDATE note_candidates SET status = 'rejected' WHERE user_id = ? AND status = 'pending'"
  )
    .bind(userId)
    .run();
  return c.json({ ok: true });
});
