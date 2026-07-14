// Per-user preferences: view visibility/order + the user's own MCP bearer token.

import { Hono } from "hono";
import { type Bindings, getUserId, uuid } from "../db";
import type { UserPrefs } from "../../shared/types";

export const prefs = new Hono<{ Bindings: Bindings }>();

const EMPTY: UserPrefs = { hiddenViews: [], viewOrder: [], viewDefaults: {} };

function cleanViewDefaults(v: unknown): UserPrefs["viewDefaults"] {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as UserPrefs["viewDefaults"])
    : {};
}

const cleanFallback = (v: unknown): string | null =>
  typeof v === "string" && v ? v : null;

// Undefined means "not set yet" → default on; only an explicit false turns it off.
const cleanDim = (v: unknown): boolean => (v === false ? false : true);
const cleanOnByDefault = (v: unknown): boolean => (v === false ? false : true);

function parsePrefs(raw: unknown): UserPrefs {
  if (typeof raw !== "string") return { ...EMPTY };
  try {
    const p = JSON.parse(raw) as Partial<UserPrefs>;
    return {
      hiddenViews: Array.isArray(p.hiddenViews) ? p.hiddenViews : [],
      viewOrder: Array.isArray(p.viewOrder) ? p.viewOrder : [],
      viewDefaults: cleanViewDefaults(p.viewDefaults),
      triageFallbackAreaId: cleanFallback(p.triageFallbackAreaId),
      dimDistantTasks: cleanDim(p.dimDistantTasks),
      gcalSyncTimeBlocks: cleanOnByDefault(p.gcalSyncTimeBlocks),
      gcalSyncDueDates: cleanOnByDefault(p.gcalSyncDueDates),
    };
  } catch {
    return { ...EMPTY };
  }
}

prefs.get("/", async (c) => {
  const userId = await getUserId(c);
  const row = await c.env.DB.prepare("SELECT prefs FROM users WHERE id = ?")
    .bind(userId)
    .first<{ prefs: string }>();
  return c.json(parsePrefs(row?.prefs));
});

prefs.put("/", async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json<Partial<UserPrefs>>();
  const clean: UserPrefs = {
    hiddenViews: Array.isArray(body.hiddenViews) ? body.hiddenViews : [],
    viewOrder: Array.isArray(body.viewOrder) ? body.viewOrder : [],
    viewDefaults: cleanViewDefaults(body.viewDefaults),
    triageFallbackAreaId: cleanFallback(body.triageFallbackAreaId),
    dimDistantTasks: cleanDim(body.dimDistantTasks),
    gcalSyncTimeBlocks: cleanOnByDefault(body.gcalSyncTimeBlocks),
    gcalSyncDueDates: cleanOnByDefault(body.gcalSyncDueDates),
  };
  await c.env.DB.prepare("UPDATE users SET prefs = ? WHERE id = ?")
    .bind(JSON.stringify(clean), userId)
    .run();
  return c.json(clean);
});

// ── MCP token — per-user bearer token for the Claude Desktop integration ──────

async function ensureToken(env: Bindings, userId: string): Promise<string> {
  const existing = await env.DB.prepare(
    "SELECT token FROM mcp_tokens WHERE user_id = ? ORDER BY created_at LIMIT 1"
  )
    .bind(userId)
    .first<{ token: string }>();
  if (existing?.token) return existing.token;
  const token = `cbk_${uuid().replace(/-/g, "")}`;
  await env.DB.prepare(
    "INSERT INTO mcp_tokens (token, user_id, label) VALUES (?, ?, ?)"
  )
    .bind(token, userId, "default")
    .run();
  return token;
}

prefs.get("/mcp-token", async (c) => {
  const userId = await getUserId(c);
  return c.json({ token: await ensureToken(c.env, userId) });
});

prefs.post("/mcp-token", async (c) => {
  const userId = await getUserId(c);
  await c.env.DB.prepare("DELETE FROM mcp_tokens WHERE user_id = ?")
    .bind(userId)
    .run();
  return c.json({ token: await ensureToken(c.env, userId) });
});
