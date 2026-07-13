-- Pins: lightweight, non-task content that lives BESIDE the task system, never
-- inside it (so it can't pollute counts, Today, or planning).
--
-- Two kinds:
--   'list' — a living checklist you edit daily (shopping, conversation topics).
--            Items are a JSON array [{id,text,done}] on the row.
--   'note' — a standing reminder you mostly just look at (a goal, a quote).
--            Free text in `body`.
--
-- Any pin can be `pinned_today`, which surfaces it in an always-visible strip at
-- the top of the Today view. Others live in the sidebar Pins section.

CREATE TABLE IF NOT EXISTS pins (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'note',   -- 'note' | 'list'
  title         TEXT,
  body          TEXT,                            -- note text
  items         TEXT,                            -- JSON [{id,text,done}] for lists
  pinned_today  INTEGER NOT NULL DEFAULT 0,      -- 1 = show in the Today strip
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pins_user ON pins(user_id, position);
