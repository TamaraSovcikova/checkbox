-- Per-calendar visibility. Sync discovers every calendar and records it here so
-- the user can toggle which ones show up in Checkbox, independent of Google's own
-- shown/hidden flag. `enabled` defaults from Google's `selected` on first sight,
-- then the user owns it. Primary is flagged so the UI can keep it always on
-- (that's where task events live).

CREATE TABLE IF NOT EXISTS calendar_feeds (
  user_id     TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  summary     TEXT,
  color       TEXT,
  primary_cal INTEGER NOT NULL DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, calendar_id)
);
