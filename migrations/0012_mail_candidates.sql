-- Gmail coverage inbox, Phase A (design: tamara-main-design-20260710-135142.md).
--
-- The planner Claude already reads Gmail every morning and files tasks. This
-- table gives every thread it saw a VERDICT (filed / skipped / pending) so
-- coverage is auditable at a glance ("did anything slip through?") without a
-- mail client. No Gmail OAuth, no scopes: rows are written over MCP by whoever
-- has the reach (the planner today; a live sync in Phase B).
--
-- Dedupe is on message_id, NOT thread_id: a thread that gains a new message at
-- 2pm must produce a new row, or coverage silently hides exactly that mail.
--
-- Two orthogonal write axes (see shared/mail.ts):
--   * verdict lattice  pending < skipped < filed  (writer vs writer)
--   * user_locked flag                            (human vs writer, wins)
-- A human action (Dismiss / Accept / Create task) sets user_locked=1, freezing
-- the row against all writers so a dismissed thread can never be re-filed by the
-- next planner run (design finding A1).

CREATE TABLE IF NOT EXISTS mail_candidates (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source       TEXT NOT NULL,             -- 'planner' | 'gmail_sync' | 'forward' | 'user'
  thread_id    TEXT NOT NULL,
  message_id   TEXT NOT NULL,             -- the specific message THIS row represents
  permalink    TEXT,                      -- deep link back into Gmail
  from_addr    TEXT,
  subject      TEXT,
  snippet      TEXT,                      -- Gmail's free snippet; no bodies, no MIME
  received_at  TEXT,
  verdict      TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'filed' | 'skipped'
  reason       TEXT,                      -- one line: why filed or skipped
  task_id      TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  user_locked  INTEGER NOT NULL DEFAULT 0, -- 1 once a human rules on the row
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per message: the upsert key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_candidates_msg
  ON mail_candidates(user_id, message_id);
-- Group a conversation's messages (the coverage UI buckets by thread).
CREATE INDEX IF NOT EXISTS idx_mail_candidates_thread
  ON mail_candidates(user_id, thread_id);
-- The coverage panel lists by recency within the fetch window.
CREATE INDEX IF NOT EXISTS idx_mail_candidates_received
  ON mail_candidates(user_id, received_at);

-- A task remembers the Gmail thread it came from, so it can reach back to it
-- (Open in Gmail / draft a reply) regardless of which writer created the row.
ALTER TABLE tasks ADD COLUMN gmail_thread_id TEXT;
ALTER TABLE tasks ADD COLUMN gmail_message_id TEXT;
ALTER TABLE tasks ADD COLUMN gmail_permalink TEXT;
