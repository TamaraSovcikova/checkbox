// Today-capacity maths, pure and clock-free: the caller supplies "now" and the
// day's busy blocks as minutes-since-local-midnight, this answers whether what
// is planned still fits in the day. Free time = now -> day end, minus calendar
// busy overlap (merged, so stacked meetings do not double-subtract).

export interface Capacity {
  plannedMin: number; // sum of estimates on open tasks
  unestimated: number; // open tasks carrying no estimate
  freeMin: number; // minutes of unbooked time left before day end
  over: boolean; // planned exceeds free
}

export function computeCapacity(
  estimates: (number | null | undefined)[],
  busy: [number, number][], // timed events today, [startMin, endMin] local
  nowMin: number,
  dayEndMin = 22 * 60
): Capacity {
  const plannedMin = estimates.reduce<number>((s, e) => s + (e || 0), 0);
  const unestimated = estimates.filter((e) => !e).length;

  const windowStart = Math.min(nowMin, dayEndMin);
  let freeMin = dayEndMin - windowStart;

  // Merge busy intervals clipped to the remaining window, then subtract.
  const clipped = busy
    .map(([s, e]): [number, number] => [Math.max(s, windowStart), Math.min(e, dayEndMin)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let cursor = windowStart;
  for (const [s, e] of clipped) {
    const start = Math.max(s, cursor);
    if (e > start) {
      freeMin -= e - start;
      cursor = e;
    }
  }

  freeMin = Math.max(0, freeMin);
  return { plannedMin, unestimated, freeMin, over: plannedMin > 0 && plannedMin > freeMin };
}

// "4h 10m" / "45m" / "0m"
export function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
