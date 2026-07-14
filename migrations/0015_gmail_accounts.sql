-- Gmail coverage, Phase B: the Worker gets its own Google connection so it can
-- pull recent threads live ("Refresh from Gmail"), instead of waiting for the
-- planner's next run.
--
-- Deliberately a SEPARATE table from calendar_accounts, NOT a rename of it
-- (design revision to step 9): Gmail keeps its own encrypted token and its own
-- last_error pair, so revoking Gmail can never take down calendar sync, and a
-- calendar success can never erase a live Gmail error. UNIQUE(user_id) is
-- included from the start (the missing index that let calendar_accounts get
-- duplicate rows).
--
-- Scope requested: gmail.modify only. It subsumes read (this phase) plus
-- draft/label/archive (a later phase), so there's no re-consent. It is
-- send-capable, but the never-send invariant is enforced in code
-- (test/invariants.test.ts), not by scope.

CREATE TABLE IF NOT EXISTS gmail_accounts (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_email      TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,          -- AES-GCM encrypted
  access_token      TEXT,
  token_expiry      TEXT,
  scopes            TEXT,
  last_error        TEXT,
  last_error_at     TEXT,
  last_sync_at      TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gmail_accounts_user ON gmail_accounts(user_id);
