-- Today's Focus (#3): an ordered shortlist of what to work on now, separate
-- from priority.
--
-- Priority ranks importance in four levels, which cannot order three P1 tasks,
-- and nothing marked "doing this now". The only manual order was
-- tasks.position, one number per task shared by every list it appears in, so
-- there was no order that belonged to the day alone.
--
-- A task is in focus only while focus_date is TODAY (the user's today, see
-- shared/tz), so yesterday's focus expires by itself with no cron, and an
-- unfinished one can be offered for carry-over the next morning.
ALTER TABLE tasks ADD COLUMN focus_date TEXT;
ALTER TABLE tasks ADD COLUMN focus_rank INTEGER;
CREATE INDEX IF NOT EXISTS idx_tasks_focus ON tasks(user_id, focus_date);
