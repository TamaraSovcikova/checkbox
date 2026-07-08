import { Hono } from "hono";
import { type Bindings, getUserId, uuid } from "../db";

export const attachments = new Hono<{ Bindings: Bindings }>();

// Per-file and total-storage caps. R2's free tier is 10 GB; we stop well short so
// attachments can NEVER push the account into paid territory. Uploads past the
// total cap are rejected (link attachments still work). Bump these only if you
// deliberately accept R2 storage charges past 10 GB.
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file
const FREE_TIER_STORAGE_CAP = 5 * 1024 * 1024 * 1024; // 5 GB total (half the free tier)

// Sum of bytes this user already has stored in R2.
async function usedBytes(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(a.size_bytes), 0) AS used
         FROM attachments a JOIN tasks t ON t.id = a.task_id
        WHERE t.user_id = ? AND a.kind = 'file'`
    )
    .bind(userId)
    .first<{ used: number }>();
  return Number(row?.used ?? 0);
}

async function ownsTask(db: D1Database, userId: string, taskId: string) {
  const row = await db
    .prepare("SELECT 1 FROM tasks WHERE id = ? AND user_id = ?")
    .bind(taskId, userId)
    .first();
  return !!row;
}

// List a task's attachments (files + links), newest first.
attachments.get("/:taskId", async (c) => {
  const userId = await getUserId(c);
  const taskId = c.req.param("taskId");
  if (!(await ownsTask(c.env.DB, userId, taskId)))
    return c.json({ error: "not found" }, 404);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM attachments WHERE task_id = ? ORDER BY created_at DESC"
  )
    .bind(taskId)
    .all();
  return c.json(results);
});

// Add a link attachment (no storage needed).
attachments.post("/:taskId/link", async (c) => {
  const userId = await getUserId(c);
  const taskId = c.req.param("taskId");
  if (!(await ownsTask(c.env.DB, userId, taskId)))
    return c.json({ error: "not found" }, 404);
  const b = await c.req.json<{ url: string; filename?: string }>();
  if (!b.url?.trim()) return c.json({ error: "url required" }, 400);
  const id = uuid();
  await c.env.DB.prepare(
    "INSERT INTO attachments (id, task_id, kind, url, filename) VALUES (?, ?, 'link', ?, ?)"
  )
    .bind(id, taskId, b.url.trim(), b.filename?.trim() || b.url.trim())
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM attachments WHERE id = ?")
    .bind(id)
    .first();
  return c.json(row, 201);
});

// Upload a file to R2. Body is the raw file bytes; filename comes from the
// ?filename= query. Returns 501 when the R2 bucket isn't bound (link-only mode).
attachments.post("/:taskId/file", async (c) => {
  const userId = await getUserId(c);
  const taskId = c.req.param("taskId");
  if (!(await ownsTask(c.env.DB, userId, taskId)))
    return c.json({ error: "not found" }, 404);
  if (!c.env.ATTACHMENTS)
    return c.json({ error: "file storage not configured" }, 501);

  const filename = c.req.query("filename") || "file";
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "empty body" }, 400);
  if (body.byteLength > MAX_FILE_BYTES)
    return c.json({ error: "file too large (max 25MB)" }, 413);

  // Free-tier guard: never let total stored bytes cross the cap (stays under R2's
  // 10 GB free tier, so uploads can't incur charges).
  const used = await usedBytes(c.env.DB, userId);
  if (used + body.byteLength > FREE_TIER_STORAGE_CAP)
    return c.json(
      {
        error:
          "storage limit reached (free-tier guard) — delete some files or attach a link instead",
      },
      507
    );

  const id = uuid();
  const key = `att/${userId}/${taskId}/${id}`;
  await c.env.ATTACHMENTS.put(key, body, {
    httpMetadata: {
      contentType: c.req.header("content-type") || "application/octet-stream",
    },
  });
  await c.env.DB.prepare(
    "INSERT INTO attachments (id, task_id, kind, url, filename, size_bytes) VALUES (?, ?, 'file', ?, ?, ?)"
  )
    .bind(id, taskId, key, filename, body.byteLength)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM attachments WHERE id = ?")
    .bind(id)
    .first();
  return c.json(row, 201);
});

// Stream a stored file back to the browser (own-task gated via the row).
attachments.get("/file/:id", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    `SELECT a.url, a.filename FROM attachments a
       JOIN tasks t ON t.id = a.task_id
      WHERE a.id = ? AND a.kind = 'file' AND t.user_id = ?`
  )
    .bind(id, userId)
    .first<{ url: string; filename: string | null }>();
  if (!row) return c.json({ error: "not found" }, 404);
  if (!c.env.ATTACHMENTS) return c.json({ error: "storage unavailable" }, 501);
  const obj = await c.env.ATTACHMENTS.get(row.url);
  if (!obj) return c.json({ error: "not found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  if (row.filename)
    headers.set(
      "content-disposition",
      `inline; filename="${row.filename.replace(/"/g, "")}"`
    );
  return new Response(obj.body, { headers });
});

// Delete an attachment (and its R2 object if it's a file).
attachments.delete("/:taskId/:id", async (c) => {
  const userId = await getUserId(c);
  const taskId = c.req.param("taskId");
  if (!(await ownsTask(c.env.DB, userId, taskId)))
    return c.json({ error: "not found" }, 404);
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT kind, url FROM attachments WHERE id = ? AND task_id = ?"
  )
    .bind(id, taskId)
    .first<{ kind: string; url: string }>();
  if (row?.kind === "file" && c.env.ATTACHMENTS) {
    c.executionCtx?.waitUntil(c.env.ATTACHMENTS.delete(row.url).catch(() => {}));
  }
  await c.env.DB.prepare("DELETE FROM attachments WHERE id = ? AND task_id = ?")
    .bind(id, taskId)
    .run();
  return c.json({ ok: true });
});
