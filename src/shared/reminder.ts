// Due-time reminder decision, pure so both the cron sweep and its tests agree.
// A task earns a reminder push when ALL hold:
//   - it is open,
//   - it is due TODAY at a specific time (a date-only task is the morning
//     brief's job, not a reminder's),
//   - that time has passed (the 15-minute cron means "passed within the last
//     few minutes" in practice),
//   - no reminder was ever sent for it (reminder_sent_at is the once-guard;
//     rescheduling to a new day clears it server-side so the task can remind
//     again on the new day).

export interface RemindableTask {
  status: string;
  due_date: string | null;
  due_time: string | null; // "HH:MM"
  reminder_sent_at: string | null;
}

export function reminderDue(
  t: RemindableTask,
  today: string, // YYYY-MM-DD in the user's timezone
  nowHHMM: string // "HH:MM" in the user's timezone
): boolean {
  if (t.status === "done") return false;
  if (!t.due_date || t.due_date !== today) return false;
  if (!t.due_time) return false;
  if (t.reminder_sent_at) return false;
  return t.due_time <= nowHHMM;
}
