-- Indexes for the queries that were reading whole tables (2026-09-27).
--
-- The account hit D1's free limit of 5,000,000 rows read in a day. D1 counts
-- every row a query scans, not the rows it returns, and the top offenders were
-- scans a missing index turned into full-table reads:
--   label counts         21,611 rows per load (no index on task_labels.label_id)
--   calendar checks       ~2,400 rows per sync, three queries, every 15 minutes
--   calendar range        ~5,200 rows per view (no index on start)
--   every task view         ~700 rows (all tasks, done ones included)

-- Label counts join from the label side.
CREATE INDEX IF NOT EXISTS idx_task_labels_label ON task_labels(label_id);

-- The sync's consistency checks look only at Checkbox-owned events.
CREATE INDEX IF NOT EXISTS idx_evcache_owned ON calendar_events_cache(user_id, is_checkbox_owned);

-- The calendar view asks for one date range.
CREATE INDEX IF NOT EXISTS idx_evcache_user_start ON calendar_events_cache(user_id, start);

-- Open top-level tasks: what every active view starts from. Partial, so it
-- holds only open, unparked, top-level tasks and a view never walks the
-- completed ones.
CREATE INDEX IF NOT EXISTS idx_tasks_open ON tasks(user_id)
  WHERE status != 'done' AND parent_task_id IS NULL AND parked_at IS NULL;

-- Completed tasks by completion time: completed-today, stats, the nightly sweep.
CREATE INDEX IF NOT EXISTS idx_tasks_done ON tasks(user_id, completed_at)
  WHERE status = 'done';
