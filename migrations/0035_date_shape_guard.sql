-- A date column may hold a real date or nothing. Nothing else.
--
-- Backstop for the "null" incident: the MCP connector typed due_date as a plain
-- string while documenting "or null to clear", so clearing a due date wrote the
-- four characters n-u-l-l into the column. About 50 tasks were affected. The
-- client formats due dates with date-fns, which coerces with +, so +"null" is
-- NaN and the formatter throws; with no error boundary the whole route
-- unmounted and the app rendered blank. /backlog and /calendar survived only
-- because neither formats those fields.
--
-- The writers are fixed (shared/dates.ts gates every REST and MCP write). This
-- is the layer that does not depend on remembering: SQLite cannot add a CHECK
-- constraint to an existing table without rebuilding it, so the same rule is
-- expressed as triggers. They ABORT rather than coerce, deliberately: a write
-- that silently became NULL would trade a loud crash for a quietly missing
-- deadline, which is the worse of the two.
--
-- GLOB, not LIKE: LIKE has no character classes, and '____-__-__' would accept
-- "abcd-ef-gh". This checks shape only; the writers check that the day exists.

CREATE TRIGGER IF NOT EXISTS tasks_dates_shape_insert
BEFORE INSERT ON tasks
FOR EACH ROW WHEN
  (NEW.due_date         IS NOT NULL AND NEW.due_date         NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') OR
  (NEW.planned_date     IS NOT NULL AND NEW.planned_date     NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') OR
  (NEW.snoozed_until    IS NOT NULL AND NEW.snoozed_until    NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') OR
  (NEW.blocked_until    IS NOT NULL AND NEW.blocked_until    NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') OR
  (NEW.waiting_expected IS NOT NULL AND NEW.waiting_expected NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') OR
  (NEW.checkpoint_next  IS NOT NULL AND NEW.checkpoint_next  NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') OR
  (NEW.recurrence_until IS NOT NULL AND NEW.recurrence_until NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
BEGIN
  SELECT RAISE(ABORT, 'task date must be YYYY-MM-DD or NULL');
END;

CREATE TRIGGER IF NOT EXISTS tasks_dates_shape_update
BEFORE UPDATE ON tasks
FOR EACH ROW WHEN
  (NEW.due_date         IS NOT NULL AND NEW.due_date         NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') OR
  (NEW.planned_date     IS NOT NULL AND NEW.planned_date     NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') OR
  (NEW.snoozed_until    IS NOT NULL AND NEW.snoozed_until    NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') OR
  (NEW.blocked_until    IS NOT NULL AND NEW.blocked_until    NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') OR
  (NEW.waiting_expected IS NOT NULL AND NEW.waiting_expected NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') OR
  (NEW.checkpoint_next  IS NOT NULL AND NEW.checkpoint_next  NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') OR
  (NEW.recurrence_until IS NOT NULL AND NEW.recurrence_until NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
BEGIN
  SELECT RAISE(ABORT, 'task date must be YYYY-MM-DD or NULL');
END;

-- A subtask's due date carries its parent into Today, so it reaches the same
-- formatters and deserves the same guard.
CREATE TRIGGER IF NOT EXISTS subtasks_dates_shape_insert
BEFORE INSERT ON subtasks
FOR EACH ROW WHEN
  NEW.due_date IS NOT NULL AND NEW.due_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
BEGIN
  SELECT RAISE(ABORT, 'subtask due_date must be YYYY-MM-DD or NULL');
END;

CREATE TRIGGER IF NOT EXISTS subtasks_dates_shape_update
BEFORE UPDATE ON subtasks
FOR EACH ROW WHEN
  NEW.due_date IS NOT NULL AND NEW.due_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
BEGIN
  SELECT RAISE(ABORT, 'subtask due_date must be YYYY-MM-DD or NULL');
END;

CREATE TRIGGER IF NOT EXISTS projects_dates_shape_insert
BEFORE INSERT ON projects
FOR EACH ROW WHEN
  (NEW.start_date IS NOT NULL AND NEW.start_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') OR
  (NEW.due_date   IS NOT NULL AND NEW.due_date   NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
BEGIN
  SELECT RAISE(ABORT, 'project date must be YYYY-MM-DD or NULL');
END;

CREATE TRIGGER IF NOT EXISTS projects_dates_shape_update
BEFORE UPDATE ON projects
FOR EACH ROW WHEN
  (NEW.start_date IS NOT NULL AND NEW.start_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') OR
  (NEW.due_date   IS NOT NULL AND NEW.due_date   NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
BEGIN
  SELECT RAISE(ABORT, 'project date must be YYYY-MM-DD or NULL');
END;
