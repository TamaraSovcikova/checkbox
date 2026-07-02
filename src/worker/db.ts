import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

export type Bindings = {
  DB: D1Database;
  SESSIONS: KVNamespace;
  ASSETS: Fetcher;
  // Calendar integration — set via wrangler secret in prod, .dev.vars locally.
  GOOGLE_CLIENT_ID: string | undefined;
  GOOGLE_CLIENT_SECRET: string | undefined;
  CALENDAR_ENCRYPTION_KEY: string | undefined; // 64-char hex (32 bytes)
  // Base URL of the Worker (http://localhost:8787 locally, https://... in prod).
  WORKER_URL: string;
  // MCP server bearer token — legacy single-token, maps to the owner. Per-user
  // tokens live in the mcp_tokens table now; this stays for back-compat.
  MCP_AUTH_TOKEN: string | undefined;
  // Web Push (VAPID) — generate with: node scripts/gen-vapid.mjs
  VAPID_PUBLIC_KEY: string | undefined;
  VAPID_PRIVATE_KEY_JWK: string | undefined;
  // Resend email digest — get from resend.com
  RESEND_API_KEY: string | undefined;
  // Local dev only: "1" resolves the first user row when no session/token is
  // present, so the app works without logging in. Never set in production.
  DEV_AUTH_BYPASS: string | undefined;
};

export type AppContext = Context<{ Bindings: Bindings }>;

export const uuid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

// ── Sessions & auth ──────────────────────────────────────────────────────────

export type Session = {
  userId: string;
  email: string;
  name?: string;
  avatar?: string;
};

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const sessionKey = (id: string) => `session:${id}`;

function readCookie(header: string | undefined, key: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === key) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

// Create a KV session and return its id. Caller sets the cb_session cookie.
export async function createSession(
  env: Bindings,
  session: Session
): Promise<string> {
  const id = crypto.randomUUID();
  await env.SESSIONS.put(sessionKey(id), JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return id;
}

export async function destroySession(env: Bindings, id: string): Promise<void> {
  await env.SESSIONS.delete(sessionKey(id));
}

export function sessionCookie(id: string, secure: boolean): string {
  const flags = [
    `cb_session=${id}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (secure) flags.push("Secure");
  return flags.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  const flags = ["cb_session=", "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"];
  if (secure) flags.push("Secure");
  return flags.join("; ");
}

export function getSessionId(c: AppContext): string | undefined {
  return readCookie(c.req.header("Cookie"), "cb_session");
}

export async function getSession(c: AppContext): Promise<Session | null> {
  const id = getSessionId(c);
  if (!id) return null;
  const raw = await c.env.SESSIONS.get(sessionKey(id));
  return raw ? (JSON.parse(raw) as Session) : null;
}

// Resolve a user from an Authorization: Bearer token (MCP clients). Returns the
// user_id, or null when the token is absent/unknown.
export async function resolveBearerUser(
  env: Bindings,
  authHeader: string | undefined
): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  const row = await env.DB.prepare(
    "SELECT user_id FROM mcp_tokens WHERE token = ?"
  )
    .bind(token)
    .first<{ user_id: string }>();
  if (row?.user_id) {
    // best-effort last_used bump (don't block the request on it)
    await env.DB.prepare("UPDATE mcp_tokens SET last_used = ? WHERE token = ?")
      .bind(now(), token)
      .run()
      .catch(() => {});
    return row.user_id;
  }
  // Back-compat: the legacy single MCP_AUTH_TOKEN maps to the owner (first user).
  if (env.MCP_AUTH_TOKEN && token === env.MCP_AUTH_TOKEN) {
    const owner = await env.DB.prepare(
      "SELECT id FROM users ORDER BY created_at LIMIT 1"
    ).first<{ id: string }>();
    return owner?.id ?? null;
  }
  return null;
}

// Local-dev fallback: return the first user row, seeding one if the DB is empty.
export async function devUser(env: Bindings): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT id FROM users ORDER BY created_at LIMIT 1"
  ).first<{ id: string }>();
  if (row?.id) return row.id;
  const id = uuid();
  await env.DB.prepare(
    "INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)"
  )
    .bind(id, "tamara@local", "Tamara")
    .run();
  return id;
}

/**
 * Resolve the current user for a request. Two auth contexts:
 *   1. Web app  — cb_session cookie -> KV session lookup.
 *   2. MCP       — Authorization: Bearer <token> -> mcp_tokens lookup.
 * Throws 401 when neither resolves (unless DEV_AUTH_BYPASS is set locally).
 */
export async function getUserId(c: AppContext): Promise<string> {
  const session = await getSession(c);
  if (session) return session.userId;

  const bearer = await resolveBearerUser(c.env, c.req.header("Authorization"));
  if (bearer) return bearer;

  if (c.env.DEV_AUTH_BYPASS === "1") return devUser(c.env);

  throw new HTTPException(401, { message: "Not authenticated" });
}

// D1 stores booleans as 0/1 and board_columns as a JSON string. Normalise on read.
export function rowToTask(r: Record<string, unknown>): Record<string, unknown> {
  return {
    ...r,
    priority: Number(r.priority),
    position: Number(r.position),
    time_estimate_min:
      r.time_estimate_min == null ? null : Number(r.time_estimate_min),
  };
}

export function rowToProject(
  r: Record<string, unknown>
): Record<string, unknown> {
  let cols: string[] = ["To do", "Doing", "Done"];
  try {
    if (typeof r.board_columns === "string")
      cols = JSON.parse(r.board_columns);
  } catch {
    /* keep default */
  }
  return { ...r, board_columns: cols, position: Number(r.position) };
}

export function rowToSubtask(
  r: Record<string, unknown>
): Record<string, unknown> {
  return { ...r, done: Number(r.done) === 1, position: Number(r.position) };
}
