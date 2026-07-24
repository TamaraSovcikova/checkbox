// Flow view layout: pure dependency-graph layering for a project's tasks.
// Renders nowhere itself; ProjectFlow.tsx draws the result as a metro map.
// See docs/DESIGN-project-flow.md (vault) for the approved design.

import type { Task } from "./types";

export interface FlowEdge {
  from: string; // blocker
  to: string; // the task it unlocks
  critical: boolean;
}

export interface FlowLayout {
  // step index -> tasks in that step, sorted for display (due first, then
  // priority, then title, so within a step the most pressing sits first).
  steps: Task[][];
  stepOf: Map<string, number>;
  edges: FlowEdge[];
  // Open tasks whose every blocker is done: what can be picked up right now.
  frontier: Set<string>;
  // Task ids on the longest chain through the project (done ones included:
  // the spine is the spine even where it is already walked).
  critical: Set<string>;
  // Tasks stuck in a dependency cycle. The server rejects a direct A<->B
  // reverse edge but nothing stops A->B->C->A, so layout must not hang on it.
  cyclic: Set<string>;
}

// Layer by longest path over the FULL graph, done edges included, so geometry
// stays stable as tasks complete: done-ness is paint, not position.
//
// step(t) = 1 + max(step(in-set blockers)); no blockers = step 0. Deps that
// point OUTSIDE the given task set (cross-project links) do not move a task's
// column, because there is no station to draw the line from; they still count
// for the frontier, which reads every blocker's status off the hydrated ref.
export function flowLayout(tasks: Task[]): FlowLayout {
  const byId = new Map(tasks.map((t) => [t.id, t]));

  // In-set edges only.
  const blockersOf = new Map<string, string[]>();
  const edges: FlowEdge[] = [];
  for (const t of tasks) {
    const ins = (t.depends_on ?? []).filter((d) => byId.has(d.id));
    blockersOf.set(
      t.id,
      ins.map((d) => d.id)
    );
    for (const d of ins) edges.push({ from: d.id, to: t.id, critical: false });
  }

  // Iterative fixed point with a pass cap: a task assigns once all its in-set
  // blockers have. Anything unassigned after n passes sits on a cycle.
  const stepOf = new Map<string, number>();
  for (let pass = 0; pass < tasks.length + 1; pass++) {
    let progressed = false;
    for (const t of tasks) {
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
  for (const t of tasks) {
    if (!stepOf.has(t.id)) {
      cyclic.add(t.id);
      stepOf.set(t.id, parkStep);
    }
  }

  // Buckets, sorted for display.
  const stepCount = tasks.length ? Math.max(...stepOf.values()) + 1 : 0;
  const steps: Task[][] = Array.from({ length: stepCount }, () => []);
  for (const t of tasks) steps[stepOf.get(t.id)!].push(t);
  for (const bucket of steps) {
    bucket.sort(
      (a, b) =>
        (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
        a.priority - b.priority ||
        a.title.localeCompare(b.title)
    );
  }

  // Frontier: open, and EVERY blocker (in-set or not) already done. The
  // hydrated ref carries each blocker's status, so no second lookup needed.
  const frontier = new Set<string>();
  for (const t of tasks) {
    if (t.status === "done" || cyclic.has(t.id)) continue;
    if ((t.depends_on ?? []).every((d) => d.status === "done"))
      frontier.add(t.id);
  }

  // Critical path: longest chain by summed time estimate. When the project has
  // no estimates at all, every node weighs 1 and the chain is longest by hops;
  // when some exist, an unestimated node weighs a neutral 30 minutes so a
  // single missing number does not disqualify a chain.
  const anyEstimate = tasks.some((t) => t.time_estimate_min != null);
  const weight = (t: Task) =>
    anyEstimate ? t.time_estimate_min ?? 30 : 1;
  const best = new Map<string, number>();
  const parent = new Map<string, string | null>();
  // Steps are already a topological order for acyclic nodes.
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
    tip = parent.get(tip) ?? null;
  }
  for (const e of edges) {
    e.critical =
      critical.has(e.from) &&
      critical.has(e.to) &&
      parent.get(e.to) === e.from;
  }

  return { steps, stepOf, edges, frontier, critical, cyclic };
}

// ── Date rail ────────────────────────────────────────────────────────────────
// Zones the canvas by when each step's open work is due: "this week",
// "next week", then month names. A step with no open due dates carries no
// label of its own and extends the zone to its left.

export interface RailZone {
  label: string;
  fromStep: number;
  toStep: number; // inclusive
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Whole weeks between today's Monday and the date's Monday. UTC string math,
// same DST reasoning as lib/today.daysAgo.
function weekOffset(day: string, today: string): number {
  const toUTC = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const monday = (ms: number) => {
    const dow = (new Date(ms).getUTCDay() + 6) % 7; // Mon=0
    return ms - dow * 86_400_000;
  };
  return Math.round((monday(toUTC(day)) - monday(toUTC(today))) / (7 * 86_400_000));
}

export function zoneLabel(due: string, today: string): string {
  const w = weekOffset(due, today);
  if (w <= 0) return "this week";
  if (w === 1) return "next week";
  return MONTHS[Number(due.split("-")[1]) - 1];
}

export function dateRail(steps: Task[][], today: string): RailZone[] {
  const zones: RailZone[] = [];
  for (let i = 0; i < steps.length; i++) {
    const dues = steps[i]
      .filter((t) => t.status !== "done" && t.due_date != null)
      .map((t) => t.due_date!) // latest open due date defines the step
      .sort();
    const label = dues.length ? zoneLabel(dues[dues.length - 1], today) : null;
    const last = zones[zones.length - 1];
    if (label == null || (last && last.label === label)) {
      if (last) last.toStep = i;
      continue;
    }
    zones.push({ label, fromStep: i, toStep: i });
  }
  return zones;
}
