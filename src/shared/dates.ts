// One answer to "is this a date, and what is it?", used by every write path.
//
// The bug this exists to end: the MCP connector typed `due_date` as a plain
// string while its description said "or null to clear", so a client clearing a
// due date sent the four characters n-u-l-l and the column took them. About 50
// tasks ended up with due_date = "null". date-fns v4 coerces with `+`, so
// +"null" is NaN, new Date(NaN) is Invalid Date, and the formatter throws. With
// no error boundary the whole route unmounted: one bad row, blank app.
//
// The lesson worth keeping is narrower than "validate input". The corruption was
// possible because the type said string and the DOCUMENTATION said null: the
// schema and the prose disagreed, and the caller believed the prose. Anywhere a
// field means "a date, or nothing", the "nothing" has to be expressible in the
// type, and the writer has to accept the ways a caller will try to say it.

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Strings that MEAN "clear this field". They are not valid dates and they are
// not typos: they are what a caller sends when it wants null and the channel it
// is speaking through only carries strings.
const CLEARING = new Set(["", "null", "undefined", "none", "nil", "-"]);

export type DateCheck =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

// A calendar date (YYYY-MM-DD), or null.
//
// Accepts a full ISO datetime and keeps the day, because "2026-08-25T00:00:00Z"
// is a caller being precise, not a caller being wrong. Rejects everything else
// rather than coercing it to null: silently clearing a real deadline because it
// arrived as "next friday" would trade a visible crash for an invisible loss.
export function checkDate(v: unknown): DateCheck {
  if (v == null) return { ok: true, value: null };
  if (typeof v !== "string")
    return { ok: false, error: `expected a YYYY-MM-DD date, got ${typeof v}` };

  const s = v.trim();
  if (CLEARING.has(s.toLowerCase())) return { ok: true, value: null };

  const day =
    s.length > 10 && (s[10] === "T" || s[10] === " ") ? s.slice(0, 10) : s;
  if (!ISO_DATE.test(day))
    return { ok: false, error: `expected YYYY-MM-DD, got ${JSON.stringify(v)}` };

  // The shape check passes 2026-02-31. Round-trip through UTC to reject a day
  // that does not exist, since a date that cannot be rendered is the same
  // problem in a different disguise.
  const [y, m, d] = day.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  )
    return { ok: false, error: `not a real date: ${JSON.stringify(v)}` };

  return { ok: true, value: day };
}

// A datetime (anything Date can parse), or null. Used for the time-block
// columns, which store a full ISO string rather than a day.
export function checkDateTime(v: unknown): DateCheck {
  if (v == null) return { ok: true, value: null };
  if (typeof v !== "string")
    return { ok: false, error: `expected an ISO datetime, got ${typeof v}` };
  const s = v.trim();
  if (CLEARING.has(s.toLowerCase())) return { ok: true, value: null };
  if (Number.isNaN(new Date(s).getTime()))
    return { ok: false, error: `not a datetime: ${JSON.stringify(v)}` };
  return { ok: true, value: s };
}

// HH:MM, or null. The same "or null to clear" prose sits on due_time.
export function checkTime(v: unknown): DateCheck {
  if (v == null) return { ok: true, value: null };
  if (typeof v !== "string")
    return { ok: false, error: `expected HH:MM, got ${typeof v}` };
  const s = v.trim();
  if (CLEARING.has(s.toLowerCase())) return { ok: true, value: null };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s))
    return { ok: false, error: `expected HH:MM, got ${JSON.stringify(v)}` };
  return { ok: true, value: s };
}

// Every task column that holds a bare calendar date. Kept here so a new one
// cannot be added to the writers and forgotten by the validators.
export const DATE_FIELDS = [
  "due_date",
  "planned_date",
  "snoozed_until",
  "blocked_until",
  "waiting_expected",
  "checkpoint_next",
  "recurrence_until",
  // Projects, not tasks, but the name means the same thing and the project page
  // formats it the same way, so it can blank a page the same way.
  "start_date",
] as const;

export const DATETIME_FIELDS = [
  "scheduled_start",
  "scheduled_end",
  // Tracker events. Documented as "ISO datetime, or YYYY-MM-DD"; Date parses
  // both, so one check covers the pair.
  "occurred_at",
  "last_at",
] as const;
export const TIME_FIELDS = ["due_time"] as const;

// Normalise a patch body in place-ish: returns a cleaned copy, or the first
// error found. One call covers every date-shaped field a writer might carry.
export function checkDateFields(
  body: Record<string, unknown>
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const out = { ...body };
  const run = (
    fields: readonly string[],
    check: (v: unknown) => DateCheck
  ): string | null => {
    for (const f of fields) {
      if (!(f in out)) continue;
      const r = check(out[f]);
      if (!r.ok) return `${f}: ${r.error}`;
      out[f] = r.value;
    }
    return null;
  };
  const err =
    run(DATE_FIELDS, checkDate) ??
    run(DATETIME_FIELDS, checkDateTime) ??
    run(TIME_FIELDS, checkTime);
  return err ? { ok: false, error: err } : { ok: true, value: out };
}
