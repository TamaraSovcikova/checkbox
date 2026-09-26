import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { DEFAULT_TZ, isValidTimeZone, todayIn } from "../../shared/tz";

// shadcn/ui class combiner: merge conditional clsx output, de-duping conflicting
// Tailwind classes (last one wins).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// The user's timezone on the client (#5). Must match the server's day boundary
// (users.timezone, see worker/lib/tz), so "planned for today" agrees on both
// sides. Until the server answers it is the last known zone, cached, or this
// device's; useTimezone() sets the real one as soon as it loads.
const TZ_KEY = "cb:tz";
let clientTz: string = (() => {
  try {
    const cached = localStorage.getItem(TZ_KEY);
    if (isValidTimeZone(cached)) return cached;
  } catch {
    /* storage blocked: fall through */
  }
  return deviceTimeZone();
})();

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ;
  } catch {
    return DEFAULT_TZ;
  }
}

export function clientTimeZone(): string {
  return clientTz;
}

export function setClientTimeZone(tz: string) {
  if (!isValidTimeZone(tz)) return;
  clientTz = tz;
  try {
    localStorage.setItem(TZ_KEY, tz);
  } catch {
    /* storage blocked: the in-memory value still applies */
  }
}

// Today in the user's zone as YYYY-MM-DD.
export function todayStr(): string {
  return todayIn(clientTz);
}

// One month from today as YYYY-MM-DD (calendar month, day-clamped). Used to
// decide which tasks count as "distant" for the dim-far-future setting.
export function monthAheadStr(): string {
  const d = new Date();
  const day = d.getDate();
  d.setMonth(d.getMonth() + 1);
  if (d.getDate() < day) d.setDate(0); // clamp e.g. Jan 31 → Feb 28
  return todayIn(clientTz, d);
}
