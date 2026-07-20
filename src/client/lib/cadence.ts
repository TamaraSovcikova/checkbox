import type { Tracker } from "../../shared/types";

// How a cadence tracker reads: how long since, and whether that is fine.
//
// Everything here is CALENDAR days, not elapsed hours. "I called her yesterday
// evening" should say 1 day at nine the next morning, not 0 because only twelve
// hours passed. So the comparison is date-part to date-part.

// Whole days between two YYYY-MM-DD days. UTC so a DST boundary cannot make a
// day 23 or 25 hours long and round the wrong way (the trap lib/due.ts hit).
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.round((b - a) / 86_400_000);
}

// Days since the last occurrence, or null if it has never happened.
export function daysSince(tracker: Tracker, today: string): number | null {
  if (!tracker.last_at) return null;
  return daysBetween(tracker.last_at.slice(0, 10), today);
}

// fresh   - comfortably inside the cadence, or untargeted (nothing to judge)
// soon    - approaching the target (>= 75%)
// due     - at or past the target
// never   - has a target but has never been logged
export type CadenceStatus = "fresh" | "soon" | "due" | "never";

export function cadenceStatus(
  tracker: Tracker,
  today: string
): CadenceStatus {
  const since = daysSince(tracker, today);
  // No target means "count it, do not judge it". Such a tracker is never due,
  // however long it has been: inventing a deadline is exactly what the null
  // target opts out of.
  if (tracker.target_days == null) return "fresh";
  if (since == null) return "never";
  const ratio = since / tracker.target_days;
  if (ratio >= 1) return "due";
  if (ratio >= 0.75) return "soon";
  return "fresh";
}

// 0..1 for the bar's fill. Clamped at 1 so a wildly overdue tracker does not
// draw past its track; the colour is what escalates beyond that.
export function cadenceFill(tracker: Tracker, today: string): number {
  const since = daysSince(tracker, today);
  if (tracker.target_days == null || since == null) return 0;
  return Math.max(0, Math.min(1, since / tracker.target_days));
}

// Sort key: most in need of attention first.
//
// A never-logged tracker WITH a target outranks everything, because it is the
// one you have entirely failed to start. An untargeted tracker scores 0 and
// settles to the bottom whatever its age: it opted out of urgency, so it must
// not push a genuinely overdue one down the page.
export function urgency(tracker: Tracker, today: string): number {
  if (tracker.target_days == null) return 0;
  const since = daysSince(tracker, today);
  if (since == null) return Number.MAX_SAFE_INTEGER;
  return since / tracker.target_days;
}

export function sortByUrgency(trackers: Tracker[], today: string): Tracker[] {
  return [...trackers].sort((a, b) => {
    const d = urgency(b, today) - urgency(a, today);
    if (d !== 0) return d;
    // Tie-break on raw staleness so equal ratios still read oldest-first, and
    // untargeted ones (all scoring 0) order sensibly among themselves.
    return (daysSince(b, today) ?? -1) - (daysSince(a, today) ?? -1);
  });
}

// "today" / "yesterday" / "5 days ago" / "never". Short, because it sits in a
// dense row next to a bar that already carries the magnitude.
export function sinceLabel(tracker: Tracker, today: string): string {
  const since = daysSince(tracker, today);
  if (since == null) return "never";
  if (since <= 0) return "today";
  if (since === 1) return "yesterday";
  return `${since} days ago`;
}
