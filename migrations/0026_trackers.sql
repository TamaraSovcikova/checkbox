-- Cadence trackers: things where "how long since I last did this" is the point,
-- rather than "it is due on the 14th". People you want to stay in touch with,
-- plants, backups, the dentist.
--
-- Deliberately NOT tasks. Twenty people you want to keep up with are not twenty
-- to-dos: in the task store they would pollute Today, Backlog and every count,
-- and the value here is the gauge, not a checkbox. Checkbox stays the single
-- store for ACTION; a tracker that goes past its target can later emit a real
-- task, which is the seam that keeps that rule intact.

CREATE TABLE IF NOT EXISTS trackers (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  -- Label only (drives the icon/grouping), not behaviour: contact | habit |
  -- maintenance | health. Kept free-form so a new use case needs no migration.
  kind        TEXT NOT NULL DEFAULT 'contact',
  -- The cadence you are aiming for, in days. NULL means "just count for me":
  -- some things are worth watching without inventing a deadline to miss.
  target_days INTEGER,
  area_id     TEXT REFERENCES areas(id) ON DELETE SET NULL,
  notes       TEXT,
  archived    INTEGER NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trackers_user ON trackers(user_id, archived);

-- One row per occurrence. An append-only log rather than a `last_done` column on
-- the tracker, because the history IS the feature: it is what makes a chart, a
-- streak, or "am I actually getting better at this" possible later, and it is
-- what recurring TASKS cannot answer today (completing one rolls the due date
-- forward and clears completed_at, leaving no trace it ever happened).
CREATE TABLE IF NOT EXISTS tracker_events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tracker_id  TEXT NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
  -- ISO datetime. Editable, so "I actually called her on Tuesday" is recordable
  -- rather than being forced to lie about today.
  occurred_at TEXT NOT NULL,
  note        TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracker_events_tracker
  ON tracker_events(tracker_id, occurred_at DESC);
