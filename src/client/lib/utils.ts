import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// shadcn/ui class combiner: merge conditional clsx output, de-duping conflicting
// Tailwind classes (last one wins).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Brussels-local today as YYYY-MM-DD. Must match the server's day boundary
// (worker views use the same tz), so "planned for today" agrees on both sides.
export function todayStr(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// One month from today as YYYY-MM-DD (calendar month, day-clamped). Used to
// decide which tasks count as "distant" for the dim-far-future setting.
export function monthAheadStr(): string {
  const d = new Date();
  const day = d.getDate();
  d.setMonth(d.getMonth() + 1);
  if (d.getDate() < day) d.setDate(0); // clamp e.g. Jan 31 → Feb 28
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
