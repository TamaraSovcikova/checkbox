-- A short human code per task: CB-142.
--
-- Her report: agents talking about her tasks quote the uuid, because in the JSON
-- the connector hands them the uuid is the only unique thing to quote. That
-- makes a conversation about her own work unfollowable: she cannot find the task
-- being discussed without searching for a fragment of its title.
--
-- `seq` is a per-user counter; the display form (shared/taskCode) is what she
-- reads and says out loud.

ALTER TABLE tasks ADD COLUMN seq INTEGER;

-- Backfill in creation order, so the oldest task is CB-1 and the numbers read as
-- a history rather than as a shuffle. rowid breaks ties, since created_at has
-- collisions on batch-created tasks.
UPDATE tasks SET seq = (
  SELECT COUNT(*) FROM tasks t2
   WHERE t2.user_id = tasks.user_id
     AND (t2.created_at < tasks.created_at
          OR (t2.created_at = tasks.created_at AND t2.rowid <= tasks.rowid))
);

-- Codes are identifiers: two tasks sharing one would make "close CB-142"
-- ambiguous, which is the entire thing this is for.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_seq ON tasks(user_id, seq);

-- The next number to hand out, per user. A separate counter and not MAX(seq)+1
-- over the live rows, because MAX RECYCLES: delete the newest task and the next
-- one created takes its code. The code is the task's NAME, she may have written
-- it into a note or said it out loud, and a name that silently comes to mean a
-- different task is worse than no name. Caught by a test, not by inspection.
CREATE TABLE IF NOT EXISTS task_seq (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  next    INTEGER NOT NULL
);

INSERT OR REPLACE INTO task_seq (user_id, next)
  SELECT user_id, COALESCE(MAX(seq), 0) + 1 FROM tasks GROUP BY user_id;

-- Assigned by the DATABASE, not by the writers.
--
-- There are seven places that insert a task (the REST create and restore, the
-- MCP create used by two tools, templates, note extraction, mail filing, and the
-- cadence tracker emitter). Numbering them in code would mean seven chances to
-- forget, and a task with no code is one she cannot refer to. Same reasoning as
-- the date-shape triggers in 0035: a rule that must hold for every write belongs
-- where every write passes.
CREATE TRIGGER IF NOT EXISTS tasks_assign_seq
AFTER INSERT ON tasks
FOR EACH ROW WHEN NEW.seq IS NULL
BEGIN
  INSERT INTO task_seq (user_id, next) VALUES (NEW.user_id, 1)
    ON CONFLICT(user_id) DO NOTHING;
  UPDATE tasks
     SET seq = (SELECT next FROM task_seq WHERE user_id = NEW.user_id)
   WHERE id = NEW.id;
  UPDATE task_seq SET next = next + 1 WHERE user_id = NEW.user_id;
END;

-- A task inserted WITH a code keeps it: restoring a deleted task must not rename
-- it. The counter then has to move past it, or the next new task would collide
-- with a code that is already out in the world.
CREATE TRIGGER IF NOT EXISTS tasks_keep_seq
AFTER INSERT ON tasks
FOR EACH ROW WHEN NEW.seq IS NOT NULL
BEGIN
  INSERT INTO task_seq (user_id, next) VALUES (NEW.user_id, NEW.seq + 1)
    ON CONFLICT(user_id) DO UPDATE SET next = MAX(next, NEW.seq + 1);
END;
