-- The due-time reminder sweep runs every 15 minutes and asks for today's tasks
-- with a time. With only a user_id index it read every task the user has
-- (about 700 rows, ~67,000 a day) to find a handful. (user_id, due_date) lets
-- it read today's tasks only.
CREATE INDEX IF NOT EXISTS idx_tasks_user_due ON tasks(user_id, due_date);
