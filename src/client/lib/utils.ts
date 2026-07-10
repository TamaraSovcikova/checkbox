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
