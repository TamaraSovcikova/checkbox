-- Ambient AI planner (roadmap #30). Each morning the 06:00 cron drafts a
-- proposed day plan per user; the user accepts it with one tap (which writes the
-- time-blocks) or dismisses it. One plan row per user per local day.

CREATE TABLE IF NOT EXISTS day_plans (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,                     -- YYYY-MM-DD in the user's tz
  status     TEXT NOT NULL DEFAULT 'proposed',  -- proposed | accepted | dismissed
  blocks     TEXT NOT NULL DEFAULT '[]',        -- JSON [{task_id,title,priority,start,end}]
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- One plan per user/day; POST /generate upserts onto this.
CREATE UNIQUE INDEX IF NOT EXISTS idx_day_plans_user_date ON day_plans(user_id, date);
