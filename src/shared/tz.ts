// One answer to "what day is it, for this user?" (#5).
//
// The day boundary used to be Europe/Brussels, hard-coded in about fifteen
// places on both sides. `users.timezone` has existed since the first migration,
// but only the planner read it, so for anyone outside Brussels time "today"
// rolled over at the wrong hour (23:00 in the UK) and due-time reminders fired an
// hour off. Everything now asks here, with the user's zone.

// The column's default, and the fallback for a missing or unknown zone.
export const DEFAULT_TZ = "Europe/Brussels";

// Is this an IANA zone the runtime knows? Guards writes, so a typo can never
// become the zone every date is computed in.
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const safe = (tz: string | null | undefined) => (isValidTimeZone(tz) ? tz : DEFAULT_TZ);

// YYYY-MM-DD in `tz`.
export function todayIn(tz: string | null | undefined, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: safe(tz),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// HH:MM (24h) in `tz`.
export function hhmmIn(tz: string | null | undefined, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: safe(tz),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

// A date `days` after `day` (YYYY-MM-DD), through UTC so no DST boundary can
// shift it. The one copy: there were eight, identical, across routes and shared.
export function addDaysIso(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Whole calendar days from `from` to `to` (both YYYY-MM-DD), through UTC so a
// DST boundary cannot make a day 23 or 25 hours long and round the wrong way.
// The one copy: routes, the connector, suggestions and cadences all use it.
export function daysBetweenIso(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

// The user's calendar day for a stored moment. Timestamps are stored in UTC, so
// their first ten characters are the UTC date, which is the wrong day for
// anyone whose evening crosses UTC midnight (a log at 00:30 in UK summer time
// is stored as 23:30 the day before). A bare YYYY-MM-DD is already a day and is
// returned as is.
export function localDayOf(stamp: string, tz: string | null | undefined): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(stamp)) return stamp;
  const d = new Date(stamp);
  return Number.isNaN(d.getTime()) ? stamp.slice(0, 10) : todayIn(tz, d);
}
