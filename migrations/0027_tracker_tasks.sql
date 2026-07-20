-- Let a cadence tracker emit a real task when it goes past its target.
--
-- This is the seam that keeps "Checkbox is the single store for ACTION" true
-- while trackers stay gauges. A tracker is not a to-do, but "you have not called
-- Ivka in three weeks" eventually needs to become one, and that one belongs in
-- the task list with everything else rather than in a parallel place to look.

-- Opt in per tracker. Off by default: some things are worth watching without
-- generating work (the whole point of a tracker with no target).
ALTER TABLE trackers ADD COLUMN auto_task INTEGER NOT NULL DEFAULT 0;

-- Which tracker a task was emitted for. Nullable and NULL for every ordinary
-- task. ON DELETE SET NULL so deleting a tracker leaves its already-emitted task
-- alone: the work may still be worth doing, and silently deleting a task the
-- user can see is how trust in a tool goes.
--
-- The link lives here, on the task, rather than as "last emitted task" on the
-- tracker, because it makes the idempotency question answerable directly: emit
-- only if this tracker has no OPEN task. Delete the task or tick it off and the
-- next pass may emit again, which is the behaviour you want, with no extra
-- bookkeeping to drift.
ALTER TABLE tasks ADD COLUMN tracker_id TEXT REFERENCES trackers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_tracker ON tasks(tracker_id);

-- Which task caused this occurrence, when it came from ticking one off rather
-- than pressing Log. That makes un-completing exact: it removes precisely the
-- event that completion created, instead of guessing at "the latest".
ALTER TABLE tracker_events ADD COLUMN task_id TEXT;
