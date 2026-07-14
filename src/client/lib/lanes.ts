// Overlap layout for the calendar grid: pack overlapping timed items into
// side-by-side columns (like Google Calendar), so a full-day "Internship" block
// and the tasks inside it sit next to each other instead of stacking.

export type Lane = { index: number; count: number };

export function packLanes(
  items: { key: string; startMs: number; endMs: number }[]
): Map<string, Lane> {
  const sorted = [...items].sort(
    (a, b) => a.startMs - b.startMs || a.endMs - b.endMs
  );
  const out = new Map<string, Lane>();
  let cluster: typeof sorted = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const colEnds: number[] = []; // last end time per column
    for (const it of cluster) {
      let col = colEnds.findIndex((end) => it.startMs >= end);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(it.endMs);
      } else {
        colEnds[col] = it.endMs;
      }
      out.set(it.key, { index: col, count: 0 });
    }
    for (const it of cluster) out.get(it.key)!.count = colEnds.length;
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const it of sorted) {
    if (cluster.length && it.startMs >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.endMs);
  }
  if (cluster.length) flush();
  return out;
}

// A packed item's horizontal position as inline style (percent width + gap).
export function laneStyle(lane?: Lane): { left: string; width: string } {
  const count = lane?.count ?? 1;
  const index = lane?.index ?? 0;
  const width = 100 / count;
  return {
    left: `${index * width}%`,
    width: `calc(${width}% - 4px)`,
  };
}
