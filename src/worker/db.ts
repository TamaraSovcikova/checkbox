import type { Context } from "hono";

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
};

export type AppContext = Context<{ Bindings: Bindings }>;

export const uuid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

/**
 * Single-user app: resolve the current user.
 * TODO (deploy): replace with a passkey session lookup in KV (cb_session cookie).
 * For now we select the one seeded user row, creating it lazily if absent.
 */
export async function getUserId(c: AppContext): Promise<string> {
  const row = await c.env.DB.prepare("SELECT id FROM users LIMIT 1").first<{
    id: string;
  }>();
  if (row?.id) return row.id;
  const id = uuid();
  await c.env.DB.prepare(
    "INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)"
  )
    .bind(id, "tamara@local", "Tamara")
    .run();
  return id;
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
