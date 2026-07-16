-- Mark a task as optional: a nice-to-have rather than a commitment. It still
-- lives in its views and can be completed normally, it just reads as lower stakes
-- (the row renders with a dashed tick and an "optional" chip). Independent of
-- priority: an optional task can still be urgent if you choose to do it.
ALTER TABLE tasks ADD COLUMN optional INTEGER NOT NULL DEFAULT 0; -- 0 | 1
