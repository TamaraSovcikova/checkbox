-- Obsidian note→task extraction (roadmap #31). Claude reads the vault's daily
-- notes (the Worker can't reach the local filesystem) and files extracted
-- `- [ ]` / TODO items + spotted commitments here as pending candidates; the user
-- accepts them into Backlog (with a source backlink) or rejects them, one tap each.

CREATE TABLE IF NOT EXISTS note_candidates (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  source_path TEXT,                              -- vault-relative note path
  source_line INTEGER,                           -- 1-indexed line, for the backlink
  kind        TEXT NOT NULL DEFAULT 'checkbox',  -- checkbox | todo | commitment
  context     TEXT,                              -- the source line, for a preview
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending | accepted | rejected
  dedupe_key  TEXT NOT NULL,                     -- path:line:title, stable across re-scans
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Dedupe: the same note line is never offered twice, even after accept/reject.
CREATE UNIQUE INDEX IF NOT EXISTS idx_note_cand_dedupe
  ON note_candidates(user_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_note_cand_status
  ON note_candidates(user_id, status);
