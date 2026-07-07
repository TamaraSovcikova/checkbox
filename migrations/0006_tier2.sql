-- Tier 2: snooze/defer, time tracking (actuals vs estimate), task dependencies,
-- and reusable templates. Attachments + saved_filters + area color/icon already
-- exist from 0001, so no columns are added for those here.

-- ── Snooze / defer ─────────────────────────────────────────────────────────
-- When set, a task is hidden from Today/Upcoming/Overdue/Backlog until this
-- calendar day (YYYY-MM-DD). Clearing it (or the day arriving) re-surfaces it.
ALTER TABLE tasks ADD COLUMN snoozed_until TEXT;

-- ── Time tracking ──────────────────────────────────────────────────────────
-- timer_started_at: ISO instant a running timer began (NULL when not running).
-- time_spent_min: accumulated actual minutes across all past runs.
ALTER TABLE tasks ADD COLUMN timer_started_at TEXT;
ALTER TABLE tasks ADD COLUMN time_spent_min INTEGER NOT NULL DEFAULT 0;

-- ── Dependencies ("blocked by") ────────────────────────────────────────────
-- task_id is blocked by depends_on_id; task_id becomes actionable once every
-- blocker is done. Both directions cascade-delete with their task.
CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_id)
);
CREATE INDEX IF NOT EXISTS idx_taskdeps_task ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_taskdeps_dep ON task_dependencies(depends_on_id);

-- ── Templates ──────────────────────────────────────────────────────────────
-- A named set of task blueprints ("Trip prep") that expands into real tasks
-- with due dates relative to the day it is applied (offset_days from anchor).
CREATE TABLE IF NOT EXISTS templates (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  icon       TEXT,
  color      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_id);

CREATE TABLE IF NOT EXISTS template_items (
  id          TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  notes       TEXT,
  priority    INTEGER NOT NULL DEFAULT 4,
  offset_days INTEGER, -- due_date = anchor + offset_days; NULL = no due date
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_template_items_tpl ON template_items(template_id);
