-- Block a task by DATE as well as by another task. blocked_until holds a
-- YYYY-MM-DD; while today is before it, the task counts as blocked (e.g. "wait
-- until next Saturday"). Null means no date block. Works alongside task
-- dependencies (depends_on): a task is blocked if it has open blockers OR a
-- future blocked_until.
ALTER TABLE tasks ADD COLUMN blocked_until TEXT; -- YYYY-MM-DD, nullable
