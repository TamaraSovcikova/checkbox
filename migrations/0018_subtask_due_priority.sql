-- Subtasks grow up a little: each can carry its own due date and priority, so a
-- checklist item that is really "a small task under a task" can be scheduled and
-- ranked without being promoted to a full task. Both are optional (NULL = none):
-- a subtask without a priority inherits nothing and simply reads as unranked.
ALTER TABLE subtasks ADD COLUMN due_date TEXT;    -- YYYY-MM-DD, nullable
ALTER TABLE subtasks ADD COLUMN priority INTEGER; -- 1 urgent .. 4 backlog, nullable
