import { Hono } from "hono";
import { type Bindings, getUserId, uuid, now } from "../db";
import {
  resolveMailUpsert,
  coverageState,
  type MailCandidate,
  type Verdict,
} from "../../shared/mail";
import { hydrateTasks } from "./_hydrate";
import { safeHttpUrl } from "../../shared/url";

export const mail = new Hono<{ Bindings: Bindings }>();

// What a writer (the planner today, gmail_sync in Phase B) sends per thread.
export interface MailCandidateInput {
  source?: string; // default 'planner'
  thread_id: string;
  message_id: string;
  from_addr?: string | null;
  subject?: string | null;
  snippet?: string | null;
  permalink?: string | null;
  received_at?: string | null;
  verdict?: Verdict; // default 'pending'
  reason?: string | null;
  task_id?: string | null;
}

type Row = MailCandidate & { id: string };

function normalizeVerdict(v: unknown): Verdict {
  return v === "filed" || v === "skipped" ? v : "pending";
}

// Upsert one candidate from a WRITER, applying the precedence rules
// (shared/mail.ts). Returns { id, created } so callers can count new rows.
// User actions do NOT use this, they write directly and set user_locked=1.
export async function upsertMailCandidate(
  db: D1Database,
  userId: string,
  input: MailCandidateInput
): Promise<{ id: string; created: boolean }> {
  const stored = await db
    .prepare("SELECT * FROM mail_candidates WHERE user_id = ? AND message_id = ?")
    .bind(userId, input.message_id)
    .first<Row>();

  const incoming: MailCandidate = {
    source: input.source || "planner",
    thread_id: input.thread_id,
    message_id: input.message_id,
    from_addr: input.from_addr ?? null,
    subject: input.subject ?? null,
    // Written by agents over MCP, rendered as a link: http(s) only.
    permalink: safeHttpUrl(input.permalink),
    snippet: input.snippet ?? null,
    received_at: input.received_at ?? null,
    verdict: normalizeVerdict(input.verdict),
    reason: input.reason ?? null,
    task_id: input.task_id ?? null,
    user_locked: 0,
  };

  const resolved = resolveMailUpsert(stored ?? null, incoming);
  const ts = now();

  if (!stored) {
    const id = uuid();
    await db
      .prepare(
        `INSERT INTO mail_candidates
           (id, user_id, source, thread_id, message_id, permalink, from_addr,
            subject, snippet, received_at, verdict, reason, task_id, user_locked,
            created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        id,
        userId,
        resolved.source,
        resolved.thread_id,
        resolved.message_id,
        resolved.permalink,
        resolved.from_addr,
        resolved.subject,
        resolved.snippet,
        resolved.received_at,
        resolved.verdict,
        resolved.reason,
        resolved.task_id,
        resolved.user_locked,
        ts,
        ts
      )
      .run();
    return { id, created: true };
  }

  await db
    .prepare(
      `UPDATE mail_candidates SET
         source = ?, permalink = ?, snippet = ?, received_at = ?,
         verdict = ?, reason = ?, task_id = ?, user_locked = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(
      resolved.source,
      resolved.permalink,
      resolved.snippet,
      resolved.received_at,
      resolved.verdict,
      resolved.reason,
      resolved.task_id,
      resolved.user_locked,
      ts,
      stored.id
    )
    .run();
  return { id: stored.id, created: false };
}

// A row plus its coverage badge, for the inbox UI.
function withCoverage(r: Row) {
  return { ...r, coverage: coverageState(r) };
}

// ── Coverage list ─────────────────────────────────────────────────────────────
// Recent mail within the fetch window (default 7 days). The UI groups by thread.
//
// Pending rows EXPIRE. The page promises a 7-day review window, so a pending
// row that ages past it stops being "needs review" and self-skips; otherwise
// the queue grows into an unfinishable pile (it hit 92 before this existed).
// Rows the user decided on (user_locked) are never touched, and rows with no
// received_at expire off created_at so nothing lives forever.
mail.get("/candidates", async (c) => {
  const userId = await getUserId(c);
  const days = Math.min(Math.max(Number(c.req.query("days") ?? 7), 1), 90);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  await c.env.DB.prepare(
    `UPDATE mail_candidates
       SET verdict = 'skipped', reason = 'expired unreviewed', updated_at = ?
     WHERE user_id = ? AND verdict = 'pending' AND user_locked = 0
       AND COALESCE(received_at, created_at) < ?`
  )
    .bind(now(), userId, since)
    .run();

  // Same age rule as the expiry above: no received_at falls back to created_at,
  // so undated rows age out of the list instead of showing forever.
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM mail_candidates
       WHERE user_id = ? AND COALESCE(received_at, created_at) >= ?
       ORDER BY received_at DESC, created_at DESC
       LIMIT 300`
  )
    .bind(userId, since)
    .all<Row>();
  return c.json((results as Row[]).map(withCoverage));
});

async function getOwned(
  db: D1Database,
  userId: string,
  id: string
): Promise<Row | null> {
  return db
    .prepare("SELECT * FROM mail_candidates WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<Row>();
}

// ── Accept: the planner missed it → create a task and file the thread ─────────
// A human filing decision locks the row (user_locked=1) so no writer re-opens it.
mail.post("/candidates/:id/accept", async (c) => {
  const userId = await getUserId(c);
  const cand = await getOwned(c.env.DB, userId, c.req.param("id"));
  if (!cand) return c.json({ error: "not found" }, 404);

  const taskId = uuid();
  const backlink = cand.permalink ? `From Gmail: ${cand.permalink}` : null;
  const notes = [cand.from_addr && `From ${cand.from_addr}`, cand.snippet, backlink]
    .filter(Boolean)
    .join("\n\n");
  await c.env.DB.prepare(
    `INSERT INTO tasks
       (id, user_id, title, notes, priority, gmail_thread_id, gmail_message_id, gmail_permalink)
     VALUES (?, ?, ?, ?, 3, ?, ?, ?)`
  )
    .bind(
      taskId,
      userId,
      cand.subject || "(no subject)",
      notes || null,
      cand.thread_id,
      cand.message_id,
      cand.permalink
    )
    .run();

  await c.env.DB.prepare(
    `UPDATE mail_candidates
       SET verdict = 'filed', reason = 'filed by user', task_id = ?,
           source = 'user', user_locked = 1, updated_at = ?
     WHERE id = ? AND user_id = ?`
  )
    .bind(taskId, now(), cand.id, userId)
    .run();

  const row = await c.env.DB.prepare("SELECT * FROM tasks WHERE id = ?")
    .bind(taskId)
    .first();
  const [task] = await hydrateTasks(c.env.DB, [row as Record<string, unknown>]);
  return c.json(task, 201);
});

// ── Dismiss: not task-worthy → skip and lock (Dismiss must stick, A1) ─────────
mail.post("/candidates/:id/dismiss", async (c) => {
  const userId = await getUserId(c);
  const cand = await getOwned(c.env.DB, userId, c.req.param("id"));
  if (!cand) return c.json({ error: "not found" }, 404);
  await c.env.DB.prepare(
    `UPDATE mail_candidates
       SET verdict = 'skipped', reason = 'dismissed by user',
           source = 'user', user_locked = 1, updated_at = ?
     WHERE id = ? AND user_id = ?`
  )
    .bind(now(), cand.id, userId)
    .run();
  return c.json({ ok: true });
});
