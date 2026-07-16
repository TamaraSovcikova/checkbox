// The day grid's geometry and time maths, shared by the Calendar page (where you
// schedule) and Today's read-only timeline (where you just look). Both must draw
// a block in the same place, so the numbers live here rather than in either one.

export const GRID_START = 6; // 06:00
export const GRID_END = 22; // 22:00
export const PX_PER_HOUR = 64;
export const SLOT_MIN = 30; // 30-minute droppable slots

export const SLOTS: string[] = Array.from(
  { length: ((GRID_END - GRID_START) * 60) / SLOT_MIN },
  (_, i) => {
    const totalMin = GRID_START * 60 + i * SLOT_MIN;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
);

export const GRID_HEIGHT = (GRID_END - GRID_START) * PX_PER_HOUR;

export function parseHM(isoOrHHMM: string): { h: number; m: number } | null {
  if (!isoOrHHMM) return null;
  if (isoOrHHMM.includes("T")) {
    const d = new Date(isoOrHHMM);
    if (isNaN(d.getTime())) return null;
    return { h: d.getHours(), m: d.getMinutes() };
  }
  const [h, m] = isoOrHHMM.split(":").map(Number);
  return { h, m };
}

export function timeToPx(isoOrHHMM: string): number {
  const t = parseHM(isoOrHHMM);
  if (!t) return 0;
  return (t.h - GRID_START + t.m / 60) * PX_PER_HOUR;
}

// Shortest an event is ever drawn (and treated as, for overlap). Small enough
// that a 15-minute event doesn't visually spill into the next one, so touching
// events (e.g. Wake up 6:00-6:15 then Morning focus 6:15-7:45) stack cleanly
// instead of falsely colliding.
export const MIN_EVENT_MIN = 15;

// A hairline gap subtracted from each block's height so back-to-back events
// don't visually merge.
export const BLOCK_GAP = 3;

export function durationPx(start: string, end: string): number {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  const minutes = Math.max(MIN_EVENT_MIN, (e - s) / 60_000);
  return (minutes / 60) * PX_PER_HOUR;
}

// The interval an item actually occupies on screen (its real span, floored to
// the minimum draw height), used for overlap packing so the lanes match what
// the eye sees. Without the floor, a 15-min block drawn 15-min tall would never
// collide, but one drawn taller (old 30-min floor) would overlay its neighbour.
export function effectiveInterval(start: string, end: string): {
  startMs: number;
  endMs: number;
} {
  const startMs = new Date(start).getTime();
  const rawEnd = new Date(end).getTime();
  const endMs = Math.max(rawEnd, startMs + MIN_EVENT_MIN * 60_000);
  return { startMs, endMs };
}

export function fmtTime(iso: string): string {
  const t = parseHM(iso);
  if (!t) return "";
  return `${String(t.h).padStart(2, "0")}:${String(t.m).padStart(2, "0")}`;
}
