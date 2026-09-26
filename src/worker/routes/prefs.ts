// Per-user preferences: view visibility/order + the user's own MCP bearer token.

import { Hono } from "hono";
import { type Bindings, getUserId, uuid } from "../db";
import type { UserPrefs } from "../../shared/types";
import { userTz } from "../lib/tz";
import { isValidTimeZone } from "../../shared/tz";

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

// Prefs are whitelisted in BOTH directions, so any new field has to be added here
// as well or it is silently dropped on save and on read.
const cleanStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

// Cadence section registry: trimmed non-empty names, deduped, order kept.
// Undefined stays undefined so "never used sections" is distinguishable.
function cleanSections(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const n = x.trim();
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

// Dashboard layout: keep only well-formed entries. Undefined stays undefined,
// so "never customised" is distinguishable from "removed everything".
function cleanDashboard(v: unknown): UserPrefs["dashboard"] {
  if (!Array.isArray(v)) return undefined;
  // Grid coordinates: non-negative integers, spans at least 1 and at most the
  // 12-column canvas, y capped so a corrupt value cannot make a mile-tall page.
  const coord = (n: unknown, min: number, max: number): number | undefined =>
    typeof n === "number" && Number.isInteger(n) && n >= min && n <= max
      ? n
      : undefined;
  const items = v.filter(
    (x): x is Record<string, unknown> =>
      !!x && typeof x === "object" && typeof (x as any).widget === "string"
  );
  return items.map((x) => {
    const size = ["S", "M", "L"].includes(x.size as string)
      ? (x.size as "S" | "M" | "L")
      : undefined;
    const out: NonNullable<UserPrefs["dashboard"]>[number] = {
      widget: x.widget as string,
    };
    if (size) out.size = size;
    if (x.config && typeof x.config === "object" && !Array.isArray(x.config))
      out.config = x.config as Record<string, unknown>;
    const gx = coord(x.x, 0, 11);
    const gy = coord(x.y, 0, 500);
    const gw = coord(x.w, 1, 12);
    const gh = coord(x.h, 1, 40);
    if (gx !== undefined) out.x = gx;
    if (gy !== undefined) out.y = gy;
    if (gw !== undefined) out.w = gw;
    if (gh !== undefined) out.h = gh;
    return out;
  });
}

function parsePrefs(raw: unknown): UserPrefs {
  if (typeof raw !== "string") return { ...EMPTY };
  try {
    const p = JSON.parse(raw) as Partial<UserPrefs>;
    return {
      hiddenViews: Array.isArray(p.hiddenViews) ? p.hiddenViews : [],
      viewOrder: Array.isArray(p.viewOrder) ? p.viewOrder : [],
      sectionOrder: Array.isArray(p.sectionOrder) ? p.sectionOrder : undefined,
      viewDefaults: cleanViewDefaults(p.viewDefaults),
      triageFallbackAreaId: cleanFallback(p.triageFallbackAreaId),
      dimDistantTasks: cleanDim(p.dimDistantTasks),
      gcalSyncTimeBlocks: cleanOnByDefault(p.gcalSyncTimeBlocks),
      gcalSyncDueDates: cleanOnByDefault(p.gcalSyncDueDates),
      hiddenAllDayTitles: cleanStrings(p.hiddenAllDayTitles),
      todayCalendar: cleanOnByDefault(p.todayCalendar),
      todayCadences: p.todayCadences === true,
      dashboard: cleanDashboard(p.dashboard),
      cadenceSections: cleanSections(p.cadenceSections),
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
    sectionOrder: Array.isArray(body.sectionOrder) ? body.sectionOrder : undefined,
    viewDefaults: cleanViewDefaults(body.viewDefaults),
    triageFallbackAreaId: cleanFallback(body.triageFallbackAreaId),
    dimDistantTasks: cleanDim(body.dimDistantTasks),
    gcalSyncTimeBlocks: cleanOnByDefault(body.gcalSyncTimeBlocks),
    gcalSyncDueDates: cleanOnByDefault(body.gcalSyncDueDates),
    hiddenAllDayTitles: cleanStrings(body.hiddenAllDayTitles),
    todayCalendar: cleanOnByDefault(body.todayCalendar),
    todayCadences: body.todayCadences === true,
    dashboard: cleanDashboard(body.dashboard),
    cadenceSections: cleanSections(body.cadenceSections),
  };
  await c.env.DB.prepare("UPDATE users SET prefs = ? WHERE id = ?")
    .bind(JSON.stringify(clean), userId)
    .run();
  return c.json(clean);
});

// ── Timezone: the zone "today" is computed in (#5) ──────────────────────────
// Its own column (users.timezone), not part of the prefs blob, because the
// server reads it on nearly every request; see lib/tz.
prefs.get("/timezone", async (c) => {
  const userId = await getUserId(c);
  return c.json({ timezone: await userTz(c.env.DB, userId) });
});

prefs.put("/timezone", async (c) => {
  const userId = await getUserId(c);
  const { timezone } = await c.req.json<{ timezone?: unknown }>();
  if (!isValidTimeZone(timezone)) return c.json({ error: "unknown timezone" }, 400);
  await c.env.DB.prepare("UPDATE users SET timezone = ? WHERE id = ?")
    .bind(timezone, userId)
    .run();
  return c.json({ timezone });
});

// ── MCP token: per-user bearer token for the Claude Desktop integration ──────

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
