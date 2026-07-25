// Flow view layout: the RUNWAY. Pure computation behind ProjectFlow.tsx.
// Designed with Tamara over three mockup rounds (see the vault's
// DESIGN-project-flow.md); the question it answers is "what do I tackle
// first, and what after it".
//
// Shape: one green READY LINE at the far left (everything workable right
// now, overdue flagged inside it, never separated), then blocked tasks
// receding rightward at their dependency depth, every dependency drawn as a
// thin thread and the critical path as the one thick spine. Ad-hoc tasks
// (no dependency relationships at all) ride a scrollable shelf below,
// sorted by due then priority, in their own color. Bare names (no due, no
// links) sit in a last quiet row sorted by creation time.
//
// The DAILY RESET is not stored state: the caller passes only open tasks
// plus tasks completed TODAY. A blocker completed today is still visible,
// so its dependent stays at depth 1, turns green in place, and reads
// "unlocked today". Tomorrow the done card is no longer passed in, the
// dependent's visible blockers vanish, its depth becomes 0, and it wakes up
// in the ready line. Migration is a consequence of visibility, not a job.

import type { Task, TaskRef } from "./types";

export interface FlowEdge {
  from: string; // blocker
  to: string; // the task it unlocks
  spine: boolean;
}

export interface RunwayLayout {
  // depth index -> flow tasks at that depth, sorted for display. Depth 0 is
  // the ready line (plus today's completions that started there).
  slots: Task[][];
  depthOf: Map<string, number>;
  edges: FlowEdge[];
  // Open tasks whose every blocker (visible or long gone) is done.
  ready: Set<string>;
  // Ready specifically because a blocker completed TODAY (visible done).
  unlockedToday: Set<string>;
  // The critical path through the visible flow graph.
  spine: Set<string>;
  // Tasks stuck in a dependency cycle: parked in the last slot, badged.
  cyclic: Set<string>;
  // No dependency relationships at all, but dated: the shelf, due+priority.
  adhoc: Task[];
  // No dependency relationships AND no due date: bare names, oldest first.
  names: Task[];
}

const bySchedule = (a: Task, b: Task) =>
  (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
  a.priority - b.priority ||
  a.title.localeCompare(b.title);

export const isOverdue = (t: Task, today: string) =>
  t.status !== "done" && t.due_date != null && t.due_date < today;

// The still-open tasks this one unlocks. Powers the "unlocks N" chip on task
// rows: finishing this task opens those. Done dependents are not news.
export const openUnlocks = (t: Task): TaskRef[] =>
  (t.blocks ?? []).filter((d) => d.status !== "done");

// Per-project ready counts from ONE flat open-task list, for the Flow page's
// chip row. Ready here is the same rule the runway uses: open with every
// blocker done (the refs carry each blocker's status, so no second fetch).
export function readyCountsByProject(tasks: Task[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tasks) {
    if (t.project_id == null || t.status === "done") continue;
    if ((t.depends_on ?? []).every((d) => d.status === "done")) {
      counts.set(t.project_id, (counts.get(t.project_id) ?? 0) + 1);
    }
  }
  return counts;
}

export function runwayLayout(tasks: Task[]): RunwayLayout {
  const byId = new Map(tasks.map((t) => [t.id, t]));

  // A task belongs to the FLOW if it has any dependency relationship at
  // all, in either direction, visible here or not: a task whose only
  // blocker finished last week is still flow work, now simply ready. Ad-hoc
  // means genuinely unconnected. Membership is derived from BOTH ends
  // (own refs plus being referenced by any visible task), so a blocker
  // whose `blocks` list was not hydrated still counts.
  const referenced = new Set<string>();
  for (const t of tasks) for (const d of t.depends_on ?? []) referenced.add(d.id);
  const inFlow = (t: Task) =>
    (t.depends_on?.length ?? 0) > 0 ||
    (t.blocks?.length ?? 0) > 0 ||
    referenced.has(t.id);

  const flow = tasks.filter(inFlow);
  const unlinked = tasks.filter((t) => !inFlow(t));
  const adhoc = unlinked.filter((t) => t.due_date != null).sort(bySchedule);
  const names = unlinked
    .filter((t) => t.due_date == null)
    .sort(
      (a, b) =>
        (a.created_at ?? "").localeCompare(b.created_at ?? "") ||
        a.title.localeCompare(b.title)
    );

  // Visible in-set edges only: a blocker that is not passed in (completed
  // before today) satisfies readiness via its ref status but draws nothing
  // and holds nothing in place.
  const blockersOf = new Map<string, string[]>();
  const edges: FlowEdge[] = [];
  for (const t of flow) {
    const ins = (t.depends_on ?? []).filter((d) => byId.has(d.id));
    blockersOf.set(
      t.id,
      ins.map((d) => d.id)
    );
    for (const d of ins) edges.push({ from: d.id, to: t.id, spine: false });
  }

  // Depth over the visible graph. Iterative fixed point with a pass cap;
  // what never resolves sits on a cycle (the server only rejects direct
  // A<->B reverse links, so longer cycles can exist in the data).
  const depthOf = new Map<string, number>();
  for (let pass = 0; pass < flow.length + 1; pass++) {
    let progressed = false;
    for (const t of flow) {
      if (depthOf.has(t.id)) continue;
      const blockers = blockersOf.get(t.id)!;
      if (blockers.every((b) => depthOf.has(b))) {
        depthOf.set(
          t.id,
          blockers.length === 0
            ? 0
            : 1 + Math.max(...blockers.map((b) => depthOf.get(b)!))
        );
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  const cyclic = new Set<string>();
  const park = depthOf.size > 0 ? Math.max(...depthOf.values()) + 1 : 0;
  for (const t of flow) {
    if (!depthOf.has(t.id)) {
      cyclic.add(t.id);
      depthOf.set(t.id, park);
    }
  }

  const slotCount = flow.length ? Math.max(...depthOf.values()) + 1 : 0;
  const slots: Task[][] = Array.from({ length: slotCount }, () => []);
  for (const t of flow) slots[depthOf.get(t.id)!].push(t);
  for (const bucket of slots) bucket.sort(bySchedule);

  // Ready: open and every blocker done, whether that blocker is on screen
  // (completed today) or long gone. Unlocked-today: ready thanks to at
  // least one VISIBLE done blocker; these glow in place and migrate to the
  // ready line on their own at the next daily refresh.
  const ready = new Set<string>();
  const unlockedToday = new Set<string>();
  for (const t of flow) {
    if (t.status === "done" || cyclic.has(t.id)) continue;
    if ((t.depends_on ?? []).every((d) => d.status === "done")) {
      ready.add(t.id);
      const visibleDone = blockersOf
        .get(t.id)!
        .some((b) => byId.get(b)!.status === "done");
      if (visibleDone) unlockedToday.add(t.id);
    }
  }

  // Spine: heaviest chain by summed time estimate through the visible
  // graph, done-today included (the walked prefix keeps its thread until
  // midnight). No estimates anywhere = longest by hops; a lone unestimated
  // node weighs a neutral 30 minutes.
  const anyEstimate = flow.some((t) => t.time_estimate_min != null);
  const weight = (t: Task) => (anyEstimate ? t.time_estimate_min ?? 30 : 1);
  const best = new Map<string, number>();
  const parent = new Map<string, string | null>();
  for (const bucket of slots) {
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
  const spine = new Set<string>();
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
      spine.add(tip);
      tip = parent.get(tip) ?? null;
    }
  }
  for (const e of edges) {
    e.spine =
      spine.has(e.from) && spine.has(e.to) && parent.get(e.to) === e.from;
  }

  return {
    slots,
    depthOf,
    edges,
    ready,
    unlockedToday,
    spine,
    cyclic,
    adhoc,
    names,
  };
}
