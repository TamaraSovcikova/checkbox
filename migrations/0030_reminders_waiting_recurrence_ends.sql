-- Chat #56 feature batch.
-- reminder_sent_at: due-time push reminders fire once; this records the send.
-- waiting_on / waiting_expected: a task waiting on an EXTERNAL event ("Revolut
--   card arrives"), with the date it is expected by. When the date passes and
--   the task is still open, the UI flips the chip into a chase nudge.
-- recurrence_until / recurrence_count: end conditions for a recurring task.
--   until = last calendar day an occurrence may land on; count = occurrences
--   REMAINING (decremented on each completion-roll; the roll that reaches 0
--   completes the task and clears the recurrence).

ALTER TABLE tasks ADD COLUMN reminder_sent_at TEXT;
ALTER TABLE tasks ADD COLUMN waiting_on TEXT;
ALTER TABLE tasks ADD COLUMN waiting_expected TEXT;
ALTER TABLE tasks ADD COLUMN recurrence_until TEXT;
ALTER TABLE tasks ADD COLUMN recurrence_count INTEGER;
