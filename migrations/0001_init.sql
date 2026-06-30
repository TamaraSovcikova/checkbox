-- Checkbox initial schema (D1 / SQLite).
-- Booleans are INTEGER 0/1. Timestamps are TEXT ISO-8601 UTC. IDs are TEXT (uuid).
-- Task location: project_id set = in project; area_id set & project null = loose in area;
-- both null = Backlog.

PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  email        TEXT UNIQUE NOT NULL,
  display_name TEXT,
  timezone     TEXT NOT NULL DEFAULT 'Europe/Brussels',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE areas (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT,
  icon        TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_areas_user ON areas(user_id);

CREATE TABLE projects (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  area_id       TEXT REFERENCES areas(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  goal          TEXT,
  status        TEXT NOT NULL DEFAULT 'active', -- active | completed | archived
  start_date    TEXT,
  due_date      TEXT,
  board_columns TEXT NOT NULL DEFAULT '["To do","Doing","Done"]', -- JSON array
  position      INTEGER NOT NULL DEFAULT 0,
  completed_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_projects_user ON projects(user_id);
CREATE INDEX idx_projects_area ON projects(area_id);

CREATE TABLE sections (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sections_project ON sections(project_id);

CREATE TABLE recurring_rules (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type               TEXT NOT NULL, -- fixed | after_completion
  rrule              TEXT,          -- iCal RRULE for fixed
  interval_spec      TEXT,          -- JSON for after-completion, e.g. {"days":3}
  creates_block      INTEGER NOT NULL DEFAULT 0,
  block_duration_min INTEGER,
  next_due           TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tasks (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  area_id           TEXT REFERENCES areas(id) ON DELETE SET NULL,
  project_id        TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  notes             TEXT,
  priority          INTEGER NOT NULL DEFAULT 4, -- 1=urgent .. 4=backlog
  due_date          TEXT,  -- DATE (YYYY-MM-DD)
  due_time          TEXT,  -- TIME (HH:MM)
  time_estimate_min INTEGER,
  scheduled_start   TEXT,  -- DATETIME for a time-block
  scheduled_end     TEXT,
  board_column      TEXT,
  section_id        TEXT REFERENCES sections(id) ON DELETE SET NULL,
  parent_task_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  recurring_rule_id TEXT REFERENCES recurring_rules(id) ON DELETE SET NULL,
  gcal_event_id     TEXT,
  gcal_calendar_id  TEXT,
  position          INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'todo', -- todo | doing | done
  completed_at      TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tasks_user ON tasks(user_id);
CREATE INDEX idx_tasks_area ON tasks(area_id);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_due ON tasks(due_date);
CREATE INDEX idx_tasks_status ON tasks(status);

CREATE TABLE subtasks (
  id       TEXT PRIMARY KEY,
  task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title    TEXT NOT NULL,
  done     INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_subtasks_task ON subtasks(task_id);

CREATE TABLE labels (
  id      TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  color   TEXT
);
CREATE INDEX idx_labels_user ON labels(user_id);

CREATE TABLE task_labels (
  task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);

CREATE TABLE attachments (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL, -- file | link
  url        TEXT NOT NULL, -- R2 key or external URL
  filename   TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_attachments_task ON attachments(task_id);

CREATE TABLE saved_filters (
  id       TEXT PRIMARY KEY,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  query    TEXT NOT NULL, -- JSON
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE triage_suggestions (
  id                  TEXT PRIMARY KEY,
  task_id             TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  suggested_area_id   TEXT REFERENCES areas(id) ON DELETE SET NULL,
  suggested_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  confidence          REAL,
  reason              TEXT,
  status              TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | rejected
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE calendar_accounts (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_email      TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL, -- AES-GCM encrypted
  access_token      TEXT,
  token_expiry      TEXT,
  primary_calendar_id TEXT,
  sync_token        TEXT,
  watch_channel_id  TEXT,
  watch_expiry      TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE calendar_events_cache (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gcal_event_id     TEXT NOT NULL,
  calendar_id       TEXT NOT NULL,
  title             TEXT,
  start             TEXT,
  end               TEXT,
  all_day           INTEGER NOT NULL DEFAULT 0,
  updated           TEXT,
  is_checkbox_owned INTEGER NOT NULL DEFAULT 0,
  task_id           TEXT REFERENCES tasks(id) ON DELETE SET NULL
);
CREATE INDEX idx_evcache_user ON calendar_events_cache(user_id);
CREATE INDEX idx_evcache_event ON calendar_events_cache(gcal_event_id);

CREATE TABLE push_subscriptions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  keys       TEXT NOT NULL, -- JSON {p256dh, auth}
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
