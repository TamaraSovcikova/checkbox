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

import { safeHttpUrl } from "./url";

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

// "Whenever" and a date are contradictory claims, so the writers refuse to hold
// both. Enforced server-side rather than in the sheet, because the sheet is not
// the only writer: the MCP connector could otherwise produce a state the UI
// forbids, and an invariant that only one client honours is not an invariant.
//
// Returns the fields to clear alongside the flag, and the caller reports them.
// Deliberately loud: flagging a dated task DROPS its deadline, which is exactly
// what the flag means and exactly the sort of thing that should never happen
// quietly.
export const FLAG_FIELDS = ["whenever", "optional", "gcal_hidden"] as const;

export const WHENEVER_CLEARS = ["due_date", "due_time", "planned_date"] as const;

// Is this flag ON, however the caller expressed it?
//
// D1 has no boolean, so these columns are 0/1, and the value can arrive as a
// number, a real boolean, or a STRING: an MCP client whose cached tool schema
// predates the field will happily serialise 1 as "1". The first cut compared
// `=== 1` and silently did nothing on exactly that path, which is the same shape
// as the bug that put the text "null" in due_date: a writer trusting that the
// wire matches the schema it published.
export function flagOn(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") return v === "1" || v.toLowerCase() === "true";
  return false;
}

// ...and the value actually stored is always 0 or 1, never "1" or true, so the
// column cannot end up holding three spellings of the same thing.
export function normalizeFlags(
  body: Record<string, unknown>,
  fields: readonly string[] = FLAG_FIELDS
): Record<string, unknown> {
  const out = { ...body };
  for (const f of fields) if (f in out) out[f] = flagOn(out[f]) ? 1 : 0;
  // Every task writer (REST and MCP) already passes through here, which makes it
  // the one place a link from the wire can be vetted before it is stored.
  if ("gmail_permalink" in out) out.gmail_permalink = safeHttpUrl(out.gmail_permalink);
  return out;
}


export function applyWheneverRule(
  body: Record<string, unknown>,
  current: { due_date?: unknown; due_time?: unknown; planned_date?: unknown } = {}
): { body: Record<string, unknown>; cleared: string[] } {
  // Only when the flag is being turned ON in this write. Turning it off restores
  // nothing: the dates were a decision and re-making it is hers.
  if (!flagOn(body.whenever)) return { body, cleared: [] };
  const out = normalizeFlags(body);
  const cleared: string[] = [];
  for (const f of WHENEVER_CLEARS) {
    // Report only what actually held a value, so the message names real losses.
    const had = (f in out ? out[f] : current[f]) != null;
    if (had) cleared.push(f);
    out[f] = null;
  }
  return { body: out, cleared };
}

// The inverse rule: giving a task a date says it is no longer "whenever".
//
// applyWheneverRule closes one direction (flagging clears the dates). Without
// this the other stays open, and not hypothetically: the Today toggle on any row
// writes planned_date, so adding a flagged task to Today produced exactly the
// contradiction the flag is supposed to make impossible, from a control that
// looks entirely innocent.
//
// Deliberately triggered by SETTING a date, never by clearing one: clearing a
// due date is not a statement about deadlines in general, and would silently
// flag half her backlog.
//
// scheduled_start counts (a calendar block is scheduling), but is NOT in
// WHENEVER_CLEARS: flagging a task must never delete a calendar event, while
// putting one in the calendar is a plain enough statement of intent. Each
// direction takes the side that cannot lose data.
export const DATES_THAT_UNFLAG = [
  "due_date",
  "planned_date",
  "scheduled_start",
] as const;

export function applyDateClearsWhenever(
  body: Record<string, unknown>,
  current: { whenever?: unknown } = {}
): { body: Record<string, unknown>; unflagged: boolean } {
  // The caller said something explicit about the flag in this same write; that
  // wins, and applyWheneverRule has already had its say.
  if ("whenever" in body) return { body, unflagged: false };
  if (!flagOn(current.whenever)) return { body, unflagged: false };
  const setting = DATES_THAT_UNFLAG.some((f) => f in body && body[f] != null);
  if (!setting) return { body, unflagged: false };
  return { body: { ...body, whenever: 0 }, unflagged: true };
}
