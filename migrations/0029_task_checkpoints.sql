-- Checkpoints: make a long-horizon task surface in Today periodically, to check
-- you are on track, without moving its real due date.
--
-- A task due in three months that needs steady progress ("write the thesis",
-- "prep the talk") should not sit silent until the deadline. A checkpoint every
-- N days pops it into Today as a pulse: you glance, mark on track, and it rolls
-- to the next pulse. It is NOT a due date (that stays where it is) and NOT a
-- recurrence (the task does not complete-and-repeat); it is a separate, gentler
-- "are we on pace" signal that ends when the due date takes over.

-- The interval in days. NULL = no checkpoints. A separate column from recurrence
-- because the two mean different things and a task can have both (a fortnightly
-- check-in on a task also due monthly).
ALTER TABLE tasks ADD COLUMN checkpoint_days INTEGER;

-- The next date the task should pulse into Today (YYYY-MM-DD), or NULL when no
-- checkpoint is pending. Stored rather than derived so /views/today can match it
-- with a plain comparison, and so "mark on track" just advances one field.
-- Cleared once the next pulse would fall on or after the due date: past that the
-- due date itself is the signal, so there is nothing left to nag about.
ALTER TABLE tasks ADD COLUMN checkpoint_next TEXT;
