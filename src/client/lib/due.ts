import { format, parseISO } from "date-fns";

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

  const date = parseISO(due);
  // Inside the coming week a weekday name places it faster than a number does.
  if (due > today && due <= shift(today, 6)) return format(date, "EEE");

  const sameYear = due.slice(0, 4) === today.slice(0, 4);
  return format(date, sameYear ? "d MMM" : "d MMM yyyy");
}

// Overdue is a state worth seeing without doing the comparison yourself.
export const isOverdue = (due: string, today: string) => due < today;
