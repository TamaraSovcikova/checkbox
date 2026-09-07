import { format } from "date-fns";
import { safeParse } from "./safe-date";

// Shift a bare YYYY-MM-DD by whole days. String maths via UTC so it cannot drift
// across a DST boundary the way adding 86_400_000 to a local Date can.
function shift(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// What a due date should READ as. Rows used to print the raw ISO date
// ("2026-07-17"), which you have to decode against today every time you scan a
// list, and the single most common answer is just "today".
//
// Deliberately relative only where relative is unambiguous. Past yesterday it
// gives the date rather than "3 days ago": for anything overdue the actual day is
// what you act on, and the row is already marked overdue.
export function dueLabel(due: string, today: string): string {
  if (due === today) return "Today";
  if (due === shift(today, 1)) return "Tomorrow";
  if (due === shift(today, -1)) return "Yesterday";

  // A date that cannot be parsed prints as itself rather than throwing. This is
  // the exact call that blanked the app when ~50 rows held the string "null":
  // date-fns coerces with +, so +"null" is NaN and format throws a RangeError
  // mid-render. Writers and the database both refuse such a value now; this is
  // the layer that does not rely on either being perfect.
  const date = safeParse(due);
  if (!date) return due;
  // Inside the coming week a weekday name places it faster than a number does.
  if (due > today && due <= shift(today, 6)) return format(date, "EEE");

  const sameYear = due.slice(0, 4) === today.slice(0, 4);
  return format(date, sameYear ? "d MMM" : "d MMM yyyy");
}

// Overdue is a state worth seeing without doing the comparison yourself.
export const isOverdue = (due: string, today: string) => due < today;

// "Parked 4 months ago". The AGE is the point of showing a parked task: the
// question in a review is not what day you parked it, it is how long it has sat
// there unexamined, and a raw date makes you do that subtraction yourself.
export function parkedAgo(parkedAt: string, today: string): string {
  const day = parkedAt.slice(0, 10);
  if (day === today) return "today";
  const [py, pm, pd] = day.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const days = Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(py, pm - 1, pd)) / 86_400_000
  );
  if (days < 0) return "just now";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}
