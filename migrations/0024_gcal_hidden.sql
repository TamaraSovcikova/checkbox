-- Keep a task off Google Calendar without changing its dates.
--
-- Hiding a task's chip in the calendar's all-day box sets this. pushTaskToGcal
-- then treats the task as wanting no event, which deletes the one it made and
-- stops it re-creating one. Clearing the flag pushes a fresh event, so hiding is
-- reversible: the task's due date is untouched throughout.
--
-- This only ever governs events CHECKBOX created. Entries from the rest of the
-- calendar are not ours to delete; those are hidden client-side by title instead.
ALTER TABLE tasks ADD COLUMN gcal_hidden INTEGER NOT NULL DEFAULT 0;
