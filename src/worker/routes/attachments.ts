import { Hono } from "hono";
import { type Bindings, getUserId, uuid } from "../db";

export const attachments = new Hono<{ Bindings: Bindings }>();

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
  if (body.byteLength > 25 * 1024 * 1024)
    return c.json({ error: "file too large (max 25MB)" }, 413);

  const id = uuid();
  const key = `att/${userId}/${taskId}/${id}`;
  await c.env.ATTACHMENTS.put(key, body, {
    httpMetadata: {
      contentType: c.req.header("content-type") || "application/octet-stream",
    },
  });
  await c.env.DB.prepare(
    "INSERT INTO attachments (id, task_id, kind, url, filename) VALUES (?, ?, 'file', ?, ?)"
  )
    .bind(id, taskId, key, filename)
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
