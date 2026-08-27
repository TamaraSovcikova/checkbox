-- "Whenever I have the chance or the energy."
--
-- Her ask, and the reason it is a column rather than a label, a priority or a
-- reuse of `optional`: the app cannot currently tell the difference between a
-- task with no date because it has not been scheduled YET, and a task with no
-- date because it will never have one. Both render as empty date fields. Learn a
-- penspinning trick, read the article I bookmarked, look into n8n: these are
-- things she genuinely intends to do and will never put a deadline on, and every
-- existing signal says something else.
--
--   priority 4    ranks a commitment last. Still a commitment, can still be due.
--   optional      "I might not do this at all". A different claim entirely.
--   a label       says what it is about, not what kind of thing it is, and is
--                 four keystrokes when the whole point is one click.
--
-- What the flag buys, concretely: its own pool to browse when there IS energy,
-- and a task that stops reading as unplanned in every list that shows it.
ALTER TABLE tasks ADD COLUMN whenever INTEGER NOT NULL DEFAULT 0; -- 0 | 1

CREATE INDEX IF NOT EXISTS idx_tasks_whenever ON tasks(whenever);
