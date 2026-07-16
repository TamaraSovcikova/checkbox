import { Hono } from "hono";
import { type Bindings, getUserId, now, uuid } from "../db";

export const areas = new Hono<{ Bindings: Bindings }>();

areas.get("/", async (c) => {
  const userId = await getUserId(c);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM areas WHERE user_id = ? AND archived_at IS NULL ORDER BY position, name"
  )
    .bind(userId)
    .all();
  return c.json(results);
});

areas.post("/", async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json<{
    name: string;
    color?: string;
    icon?: string;
  }>();
  if (!body.name?.trim()) return c.json({ error: "name required" }, 400);
  const id = uuid();
  await c.env.DB.prepare(
    "INSERT INTO areas (id, user_id, name, color, icon) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(id, userId, body.name.trim(), body.color ?? null, body.icon ?? null)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM areas WHERE id = ?")
    .bind(id)
    .first();
  return c.json(row, 201);
});

areas.patch("/:id", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  const body = await c.req.json<Record<string, unknown>>();
  // `banner` ends up in an <img src>, so only allow the two shapes we mean: an
  // https link from the web, or our own uploaded-banner endpoint. This keeps a
  // javascript:/data: URL from ever being stored, let alone rendered.
  if ("banner" in body && body.banner != null) {
    const url = String(body.banner);
    if (!url.startsWith("https://") && url !== `/api/areas/${id}/banner`)
      return c.json({ error: "banner must be an https URL" }, 400);
    body.banner = url;
  }
  const fields = [
    "name",
    "color",
    "icon",
    "position",
    "archived_at",
    "palette",
    "banner",
  ].filter((f) => f in body);
  if (fields.length === 0) return c.json({ error: "no fields" }, 400);
  const set = fields.map((f) => `${f} = ?`).join(", ");
  await c.env.DB.prepare(
    `UPDATE areas SET ${set}, updated_at = ? WHERE id = ? AND user_id = ?`
  )
    .bind(...fields.map((f) => body[f]), now(), id, userId)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM areas WHERE id = ?")
    .bind(id)
    .first();
  return c.json(row);
});

// ── Banner image ──────────────────────────────────────────────────────────────

// One banner per area, so the R2 key is derived from the area id and an upload
// simply overwrites the last one. No row to track, no orphans to sweep.
const bannerKey = (userId: string, areaId: string) =>
  `banner/${userId}/${areaId}`;

const MAX_BANNER_BYTES = 5 * 1024 * 1024; // 5 MB: it is a header image, not a photo library

async function ownsArea(db: D1Database, userId: string, id: string) {
  const row = await db
    .prepare("SELECT 1 FROM areas WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first();
  return !!row;
}

// Upload a banner. Body is the raw image bytes (same shape as attachments).
areas.post("/:id/banner", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  if (!(await ownsArea(c.env.DB, userId, id)))
    return c.json({ error: "not found" }, 404);
  if (!c.env.ATTACHMENTS)
    return c.json({ error: "file storage not configured" }, 501);

  const type = c.req.header("content-type") || "";
  if (!type.startsWith("image/"))
    return c.json({ error: "banner must be an image" }, 415);
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "empty body" }, 400);
  if (body.byteLength > MAX_BANNER_BYTES)
    return c.json({ error: "image too large (max 5MB)" }, 413);

  await c.env.ATTACHMENTS.put(bannerKey(userId, id), body, {
    httpMetadata: { contentType: type },
  });
  // Point the area at our own endpoint. Cache-bust on the client via ?v=, since
  // the URL is stable across re-uploads.
  const url = `/api/areas/${id}/banner`;
  await c.env.DB.prepare(
    "UPDATE areas SET banner = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  )
    .bind(url, now(), id, userId)
    .run();
  return c.json({ banner: url });
});

areas.get("/:id/banner", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  if (!(await ownsArea(c.env.DB, userId, id)))
    return c.json({ error: "not found" }, 404);
  if (!c.env.ATTACHMENTS) return c.json({ error: "storage unavailable" }, 501);
  const obj = await c.env.ATTACHMENTS.get(bannerKey(userId, id));
  if (!obj) return c.json({ error: "not found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  // Private: this is behind the session, so it must never land in a shared cache.
  headers.set("cache-control", "private, max-age=3600");
  return new Response(obj.body, { headers });
});

areas.delete("/:id/banner", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  if (!(await ownsArea(c.env.DB, userId, id)))
    return c.json({ error: "not found" }, 404);
  if (c.env.ATTACHMENTS) await c.env.ATTACHMENTS.delete(bannerKey(userId, id));
  await c.env.DB.prepare(
    "UPDATE areas SET banner = NULL, updated_at = ? WHERE id = ? AND user_id = ?"
  )
    .bind(now(), id, userId)
    .run();
  return c.json({ ok: true });
});

areas.delete("/:id", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  // Take the banner's bytes with it: nothing else references this key, so leaving
  // it behind would be an R2 object no request could ever reach again.
  if (c.env.ATTACHMENTS) await c.env.ATTACHMENTS.delete(bannerKey(userId, id));
  await c.env.DB.prepare("DELETE FROM areas WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
  return c.json({ ok: true });
});
