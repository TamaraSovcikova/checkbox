-- Auth + multi-user (M1). Invite-scale multi-tenant: Google OAuth login, KV sessions,
-- per-user MCP bearer tokens, invite allowlist, and per-user view preferences.

-- Google identity + view-preference JSON on the user row.
-- (SQLite ADD COLUMN is idempotent-safe only if run once; these are new columns.)
ALTER TABLE users ADD COLUMN google_sub TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN prefs TEXT NOT NULL DEFAULT '{}'; -- JSON: { hiddenViews: string[], viewOrder: string[] }

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);

-- Per-user MCP bearer tokens. token is the opaque secret Claude Desktop sends.
CREATE TABLE IF NOT EXISTS mcp_tokens (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used  TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user ON mcp_tokens(user_id);

-- Invite allowlist. Only these Google emails may create a session.
-- The owner email is seeded so the first login adopts the existing data row.
CREATE TABLE IF NOT EXISTS allowed_emails (
  email      TEXT PRIMARY KEY,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO allowed_emails (email, note)
VALUES ('tamara.sovcik@gmail.com', 'owner');
