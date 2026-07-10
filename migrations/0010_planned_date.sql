-- "Add to Today": an intent-to-work-on date that is independent of the deadline.
--
-- due_date answers "when is this owed?". planned_date answers "when do I intend
-- to work on it?". Marking a task for today must not fake a deadline, so it gets
-- its own column: the task keeps its area/project and its real due date, and the
-- Today view simply also matches planned_date = today.
--
-- A planned_date in the past just falls out of Today (no overdue noise); the task
-- returns to wherever it already lived.
ALTER TABLE tasks ADD COLUMN planned_date TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_planned ON tasks(planned_date);
