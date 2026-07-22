// Checkpoint scheduling: when a long-horizon task should next pulse into Today.
//
// Shared so the client (setting/advancing) and any server logic compute the same
// date. Pure and date-string based; no Date-object timezone drift.

// Shift a bare YYYY-MM-DD by whole days via UTC, so a DST boundary cannot move
// the result a day (the trap lib/due and lib/cadence also avoid).
export function shiftDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// The next checkpoint date after `from`, or null when checkpoints should stop.
//
// They stop once the next pulse would fall on or after the due date: past that,
// the due date is the signal and another check-in would just be noise. With no
// due date they run indefinitely (an open-ended "keep an eye on this").
//
// `from` is the anchor to advance from. On first set that is today; on "mark on
// track" it is max(today, current next) so a late acknowledgement restarts the
// clock from now rather than immediately firing again.
export function nextCheckpoint(
  from: string,
  intervalDays: number,
  dueDate: string | null
): string | null {
  if (!Number.isFinite(intervalDays) || intervalDays <= 0) return null;
  const next = shiftDays(from, Math.round(intervalDays));
  if (dueDate != null && next >= dueDate) return null;
  return next;
}

// The whole update needed to START (or change) checkpoints on a task: the
// interval plus the first pulse date, anchored at today. Interval <= 0 (or the
// first pulse already reaching the due date) clears both, i.e. turns them off.
export function startCheckpointBody(
  today: string,
  intervalDays: number,
  dueDate: string | null
): { checkpoint_days: number | null; checkpoint_next: string | null } {
  const next = nextCheckpoint(today, intervalDays, dueDate);
  if (next == null) return { checkpoint_days: null, checkpoint_next: null };
  return { checkpoint_days: Math.round(intervalDays), checkpoint_next: next };
}

// The update for "mark on track": advance to the next pulse from today. Anchored
// at max(today, current next) so acknowledging early keeps the cadence and
// acknowledging late resets it from now. Returns the fields to write.
export function advanceCheckpointBody(
  today: string,
  intervalDays: number | null,
  currentNext: string | null,
  dueDate: string | null
): { checkpoint_next: string | null } {
  if (!intervalDays || intervalDays <= 0) return { checkpoint_next: null };
  const anchor =
    currentNext != null && currentNext > today ? currentNext : today;
  return { checkpoint_next: nextCheckpoint(anchor, intervalDays, dueDate) };
}
