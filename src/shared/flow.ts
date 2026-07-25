// Flow view layout: pure dependency-graph layering for a project's tasks.
// Renders nowhere itself; ProjectFlow.tsx draws the result as a metro map.
// See docs/DESIGN-project-flow.md (vault) for the approved design.
//
// v2, after the first real project (22 tasks, 13 edges) broke v1's naive
// per-step lane fan: the map is now LINE-FIRST. The graph decomposes into
// lines (the critical path first, then the longest remaining chains), each
// line holds one horizontal band for its whole life, and only merge edges
// curve. Tasks with no dependency edges at all stay OFF the canvas entirely
// (`loose`), because unconnected stations scattered on the tracks are what
// made the first render unreadable.

import type { Task } from "./types";

export interface FlowEdge {
  from: string; // blocker
  to: string; // the task it unlocks
  critical: boolean;
}

// One metro line: an ordered chain of task ids with strictly increasing
// steps, drawn on a single lane. `color` indexes LINE color palettes in the
// renderer; -1 marks the trunk (drawn in the app primary).
export interface FlowLine {
  ids: string[];
  lane: number;
  color: number;
}

export interface FlowLayout {
  // step index -> LINKED tasks in that step, sorted for display.
  steps: Task[][];
  stepOf: Map<string, number>;
  edges: FlowEdge[];
  // Open linked tasks whose every blocker is done: pick-up-now, drawn lit.
  frontier: Set<string>;
  // Task ids on the longest chain through the project (done ones included).
  critical: Set<string>;
  // Tasks stuck in a dependency cycle: parked in the last column, badged.
  cyclic: Set<string>;
  // The decomposition the renderer draws. lines[0] is always the trunk when
  // any edges exist.
  lines: FlowLine[];
  laneOf: Map<string, number>;
  lineOf: Map<string, number>;
  // Tasks with no dependency edge at all: listed beside the map, not on it.
  loose: Task[];
}

const displaySort = (a: Task, b: Task) =>
  (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
  a.priority - b.priority ||
  a.title.localeCompare(b.title);

export function flowLayout(tasks: Task[]): FlowLayout {
  const byId = new Map(tasks.map((t) => [t.id, t]));

  // In-set edges only. Deps pointing outside the set (cross-project links)
  // cannot be drawn, but they still count against the frontier below.
  const blockersOf = new Map<string, string[]>();
  const dependentsOf = new Map<string, string[]>();
  const edges: FlowEdge[] = [];
  for (const t of tasks) {
    const ins = (t.depends_on ?? []).filter((d) => byId.has(d.id));
    blockersOf.set(
      t.id,
      ins.map((d) => d.id)
    );
    for (const d of ins) {
      edges.push({ from: d.id, to: t.id, critical: false });
      (dependentsOf.get(d.id) ?? dependentsOf.set(d.id, []).get(d.id)!).push(t.id);
    }
  }

  // The map draws only tasks that are ON a line; the rest are the pool.
  const linkedIds = new Set<string>();
  for (const e of edges) {
    linkedIds.add(e.from);
    linkedIds.add(e.to);
  }
  const linked = tasks.filter((t) => linkedIds.has(t.id));
  const loose = tasks.filter((t) => !linkedIds.has(t.id)).sort(displaySort);

  // ── Layering (linked tasks only) ───────────────────────────────────────────
  // Longest path over the FULL graph, done edges included, so geometry stays
  // stable as tasks complete: done-ness is paint, not position. Iterative
  // fixed point with a pass cap; what never resolves sits on a cycle.
  const stepOf = new Map<string, number>();
  for (let pass = 0; pass < linked.length + 1; pass++) {
    let progressed = false;
    for (const t of linked) {
      if (stepOf.has(t.id)) continue;
      const blockers = blockersOf.get(t.id)!;
      if (blockers.every((b) => stepOf.has(b))) {
        stepOf.set(
          t.id,
          blockers.length === 0
            ? 0
            : 1 + Math.max(...blockers.map((b) => stepOf.get(b)!))
        );
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  const cyclic = new Set<string>();
  // Parked one column past the last honest step, badged, rather than hanging
  // the page. A fully cyclic graph (nothing assigned) parks at column 0.
  const parkStep = stepOf.size > 0 ? Math.max(...stepOf.values()) + 1 : 0;
  for (const t of linked) {
    if (!stepOf.has(t.id)) {
      cyclic.add(t.id);
      stepOf.set(t.id, parkStep);
    }
  }

  const stepCount = linked.length ? Math.max(...stepOf.values()) + 1 : 0;
  const steps: Task[][] = Array.from({ length: stepCount }, () => []);
  for (const t of linked) steps[stepOf.get(t.id)!].push(t);
  for (const bucket of steps) bucket.sort(displaySort);

  // ── Frontier (linked only: the pool is trivially unblocked) ────────────────
  const frontier = new Set<string>();
  for (const t of linked) {
    if (t.status === "done" || cyclic.has(t.id)) continue;
    if ((t.depends_on ?? []).every((d) => d.status === "done"))
      frontier.add(t.id);
  }

  // ── Critical path ──────────────────────────────────────────────────────────
  // Longest chain by summed time estimate. When the project has no estimates
  // at all, every node weighs 1 and the chain is longest by hops; when some
  // exist, an unestimated node weighs a neutral 30 minutes.
  const anyEstimate = linked.some((t) => t.time_estimate_min != null);
  const weight = (t: Task) => (anyEstimate ? t.time_estimate_min ?? 30 : 1);
  const best = new Map<string, number>();
  const parent = new Map<string, string | null>();
  for (const bucket of steps) {
    for (const t of bucket) {
      if (cyclic.has(t.id)) continue;
      let b = 0;
      let p: string | null = null;
      for (const blocker of blockersOf.get(t.id)!) {
        if (cyclic.has(blocker)) continue;
        const cand = best.get(blocker) ?? 0;
        if (cand > b) {
          b = cand;
          p = blocker;
        }
      }
      best.set(t.id, b + weight(t));
      parent.set(t.id, p);
    }
  }
  const critical = new Set<string>();
  const trunkIds: string[] = [];
  {
    let tip: string | null = null;
    let tipScore = -1;
    for (const [id, score] of best) {
      if (score > tipScore) {
        tipScore = score;
        tip = id;
      }
    }
    while (tip != null) {
      critical.add(tip);
      trunkIds.unshift(tip);
      tip = parent.get(tip) ?? null;
    }
  }

  // ── Line decomposition ─────────────────────────────────────────────────────
  // Trunk first, then repeatedly the longest chain (by hops) through the
  // still-unassigned residual graph, then cyclic nodes as 1-node lines. Every
  // linked task ends up on exactly one line.
  const assigned = new Set<string>();
  const rawLines: string[][] = [];
  if (trunkIds.length) {
    rawLines.push(trunkIds);
    for (const id of trunkIds) assigned.add(id);
  }
  const acyclic = linked.filter((t) => !cyclic.has(t.id));
  for (;;) {
    const todo = acyclic.filter((t) => !assigned.has(t.id));
    if (todo.length === 0) break;
    // Hop-DP over the residual graph (both endpoints unassigned).
    const rBest = new Map<string, number>();
    const rParent = new Map<string, string | null>();
    for (const bucket of steps) {
      for (const t of bucket) {
        if (assigned.has(t.id) || cyclic.has(t.id)) continue;
        let b = 0;
        let p: string | null = null;
        for (const blocker of blockersOf.get(t.id)!) {
          if (assigned.has(blocker) || cyclic.has(blocker)) continue;
          const cand = rBest.get(blocker) ?? 0;
          if (cand > b) {
            b = cand;
            p = blocker;
          }
        }
        rBest.set(t.id, b + 1);
        rParent.set(t.id, p);
      }
    }
    // Deterministic tip: most hops, then latest step, then title.
    let tip: string | null = null;
    for (const t of todo) {
      if (tip == null) {
        tip = t.id;
        continue;
      }
      const a = rBest.get(t.id)!;
      const b = rBest.get(tip)!;
      if (
        a > b ||
        (a === b &&
          (stepOf.get(t.id)! > stepOf.get(tip)! ||
            (stepOf.get(t.id) === stepOf.get(tip) &&
              byId.get(t.id)!.title < byId.get(tip)!.title)))
      )
        tip = t.id;
    }
    const chain: string[] = [];
    let cur: string | null = tip;
    while (cur != null) {
      chain.unshift(cur);
      assigned.add(cur);
      cur = rParent.get(cur) ?? null;
    }
    rawLines.push(chain);
  }
  for (const t of linked) {
    if (cyclic.has(t.id) && !assigned.has(t.id)) {
      rawLines.push([t.id]);
      assigned.add(t.id);
    }
  }

  // ── Lane packing ───────────────────────────────────────────────────────────
  // The trunk owns lane 0 exclusively. Every other line takes the nearest
  // lane (-1, +1, -2, +2, ...) whose step-interval is free: a line reserves
  // its whole [minStep, maxStep] range so nothing else lands under its
  // horizontal run. Short lines share a lane when their ranges do not touch,
  // which is what keeps a 20-node project at a handful of bands.
  const occupied = new Map<number, [number, number][]>();
  const reserve = (lane: number, lo: number, hi: number) =>
    (occupied.get(lane) ?? occupied.set(lane, []).get(lane)!).push([lo, hi]);
  const fits = (lane: number, lo: number, hi: number) =>
    (occupied.get(lane) ?? []).every(([a, b]) => hi < a || b < lo);

  const lines: FlowLine[] = [];
  const laneOf = new Map<string, number>();
  const lineOf = new Map<string, number>();
  let branchColor = 0;
  rawLines.forEach((ids, i) => {
    const isTrunk = trunkIds.length > 0 && ids === trunkIds;
    const lo = Math.min(...ids.map((id) => stepOf.get(id)!));
    const hi = Math.max(...ids.map((id) => stepOf.get(id)!));
    let lane = 0;
    if (!isTrunk) {
      for (let k = 1; ; k++) {
        const cand = k % 2 === 1 ? -((k + 1) / 2) : k / 2;
        if (fits(cand, lo, hi)) {
          lane = cand;
          break;
        }
      }
    }
    reserve(lane, lo, hi);
    const line: FlowLine = { ids, lane, color: isTrunk ? -1 : branchColor++ };
    lines.push(line);
    ids.forEach((id) => {
      laneOf.set(id, lane);
      lineOf.set(id, i);
    });
  });

  // Critical edges are exactly the trunk's internal segments.
  for (const e of edges) {
    e.critical =
      critical.has(e.from) && critical.has(e.to) && parent.get(e.to) === e.from;
  }

  return {
    steps,
    stepOf,
    edges,
    frontier,
    critical,
    cyclic,
    lines,
    laneOf,
    lineOf,
    loose,
  };
}

// Per-step latest OPEN due date, for the "by <date>" chip over each column.
// Dates annotate columns; they are NOT an axis. v1 drew a timeline-shaped
// rail over the depth axis and real data promptly printed "August, next week,
// August", because dependency depth and due dates only correlate by luck.
export function stepDues(steps: Task[][]): (string | null)[] {
  return steps.map((bucket) => {
    const dues = bucket
      .filter((t) => t.status !== "done" && t.due_date != null)
      .map((t) => t.due_date!)
      .sort();
    return dues.length ? dues[dues.length - 1] : null;
  });
}
