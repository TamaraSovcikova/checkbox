import { format, parseISO } from "date-fns";

// Formatting a stored date without trusting it.
//
// date-fns v4 coerces its argument with `+`, so a column holding the string
// "null" becomes NaN, then Invalid Date, and `format` THROWS a RangeError. A
// throw inside render unmounts the React tree, so about 50 corrupt rows turned
// the whole app blank; the pages that survived were the ones that happened not
// to format those fields.
//
// The writers now reject a bad date and the database refuses to store one, so
// this should never fire. It exists because "should never fire" is exactly the
// assumption the last one rested on: one bad row must degrade one chip, not the
// page around it. Returns null on anything unformattable, and every caller
// renders nothing rather than a broken date.
export function safeFormat(
  value: string | null | undefined,
  pattern: string
): string | null {
  const d = safeParse(value);
  if (!d) return null;
  try {
    return format(d, pattern);
  } catch {
    return null;
  }
}

// The parse half, for callers doing date arithmetic rather than formatting.
export function safeParse(value: string | null | undefined): Date | null {
  if (!value) return null;
  try {
    const d = parseISO(value);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

// Is this a storable calendar date? Used to decide whether to render a date at
// all, where the answer changes more than the formatting does.
export const isRealDate = (v: string | null | undefined): v is string =>
  !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && safeParse(v) !== null;
