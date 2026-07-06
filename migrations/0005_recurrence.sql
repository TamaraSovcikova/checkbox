-- Tier 1: per-task recurrence stored directly on the task row (roll-forward model,
-- like Todoist) instead of the separate recurring_rules table, which stays unused.
-- `recurrence` holds a compact spec parsed by lib/recurrence.ts:
--   daily | weekdays | weekly | monthly | yearly | every:N:day|week|month
--   weekly:mon,wed,fri  (specific weekdays)
-- `recurrence_mode` is `fixed` (advance from the scheduled due date) or
-- `after_completion` (advance from the completion date).
ALTER TABLE tasks ADD COLUMN recurrence TEXT;
ALTER TABLE tasks ADD COLUMN recurrence_mode TEXT NOT NULL DEFAULT 'fixed';

-- Speeds up the Cmd-K text search (LIKE on title/notes) for larger task sets.
CREATE INDEX IF NOT EXISTS idx_tasks_title ON tasks(title);
