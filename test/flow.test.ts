// Flow layout v2 (shared/flow): line-first decomposition behind the project
// Flow tab. Layering over linked tasks, loose tasks split off the canvas,
// trunk + longest-remaining chains, lane packing, frontier, cycles parked.

import { describe, it, expect } from "vitest";
import { flowLayout, stepDues } from "../src/shared/flow";
import type { Task, TaskRef } from "../src/shared/types";

const ref = (t: Task): TaskRef => ({ id: t.id, title: t.title, status: t.status });

let seq = 0;
const task = (over: Partial<Task> = {}): Task =>
  ({
    id: over.id ?? `t${++seq}`,
    title: over.id ?? `t${seq}`,
    status: "todo",
    priority: 3,
    due_date: null,
    time_estimate_min: null,
    depends_on: [],
    ...over,
  }) as Task;

// a -> b means b depends on a.
function chain(...ids: string[]): Map<string, Task> {
  const m = new Map<string, Task>();
  for (const id of ids) m.set(id, task({ id }));
  for (let i = 1; i < ids.length; i++) {
    m.get(ids[i])!.depends_on = [ref(m.get(ids[i - 1])!)];
  }
  return m;
}

describe("layering (linked tasks only)", () => {
  it("a linear chain gets one step per task, in order", () => {
    const m = chain("a", "b", "c");
    const l = flowLayout([...m.values()]);
    expect(l.steps.map((s) => s.map((t) => t.id))).toEqual([["a"], ["b"], ["c"]]);
  });

  it("a diamond layers by longest path", () => {
    const a = task({ id: "a" });
    const b = task({ id: "b", depends_on: [ref(a)] });
    const c = task({ id: "c", depends_on: [ref(a)] });
    const d = task({ id: "d", depends_on: [ref(b), ref(c)] });
    const l = flowLayout([a, b, c, d]);
    expect(l.stepOf.get("a")).toBe(0);
    expect(l.stepOf.get("b")).toBe(1);
    expect(l.stepOf.get("c")).toBe(1);
    expect(l.stepOf.get("d")).toBe(2);
  });

  it("done blockers do NOT move a task's column (paint, not position)", () => {
    const a = task({ id: "a", status: "done" });
    const b = task({ id: "b", depends_on: [ref(a)] });
    const l = flowLayout([a, b]);
    expect(l.stepOf.get("b")).toBe(1);
  });
});

describe("the loose pool", () => {
  it("tasks with no edges stay OFF the map, sorted by due then priority", () => {
    const l = flowLayout([
      task({ id: "later", due_date: "2026-08-01" }),
      task({ id: "none", priority: 1 }),
      task({ id: "soon", due_date: "2026-07-25" }),
    ]);
    expect(l.steps).toEqual([]);
    expect(l.lines).toEqual([]);
    expect(l.loose.map((t) => t.id)).toEqual(["soon", "later", "none"]);
    expect(l.frontier.size).toBe(0);
  });

  it("a dep pointing outside the set does not make a task linked", () => {
    const outside: TaskRef = { id: "elsewhere", title: "x", status: "todo" };
    const t = task({ id: "t", depends_on: [outside] });
    const l = flowLayout([t]);
    expect(l.loose.map((x) => x.id)).toEqual(["t"]);
    expect(l.edges).toEqual([]);
  });

  it("linked and loose split cleanly in a mixed project", () => {
    const m = chain("a", "b");
    const l = flowLayout([...m.values(), task({ id: "island" })]);
    expect(l.loose.map((t) => t.id)).toEqual(["island"]);
    expect(l.steps.flat().map((t) => t.id).sort()).toEqual(["a", "b"]);
  });
});

describe("frontier", () => {
  it("open with all blockers done = frontier; any open blocker = not", () => {
    const a = task({ id: "a", status: "done" });
    const b = task({ id: "b", depends_on: [ref(a)] });
    const c = task({ id: "c", depends_on: [ref(b)] });
    const l = flowLayout([a, b, c]);
    expect(l.frontier.has("a")).toBe(false); // done
    expect(l.frontier.has("b")).toBe(true);
    expect(l.frontier.has("c")).toBe(false);
  });

  it("an open chain head with no blockers is frontier", () => {
    const m = chain("a", "b");
    const l = flowLayout([...m.values()]);
    expect(l.frontier.has("a")).toBe(true);
    expect(l.frontier.has("b")).toBe(false);
  });
});

describe("critical path", () => {
  it("no estimates anywhere: longest chain by hops wins", () => {
    const m = chain("a", "b", "c");
    const n = chain("x", "y");
    const l = flowLayout([...m.values(), ...n.values()]);
    expect([...l.critical].sort()).toEqual(["a", "b", "c"]);
    const critEdges = l.edges.filter((e) => e.critical);
    expect(critEdges.map((e) => `${e.from}>${e.to}`).sort()).toEqual(["a>b", "b>c"]);
  });

  it("with estimates, a heavier short chain beats a longer light one", () => {
    const m = chain("a", "b", "c");
    const x = task({ id: "x", time_estimate_min: 120 });
    const y = task({ id: "y", time_estimate_min: 120, depends_on: [ref(x)] });
    const l = flowLayout([...m.values(), x, y]);
    expect([...l.critical].sort()).toEqual(["x", "y"]);
  });

  it("the spine runs through done tasks too", () => {
    const a = task({ id: "a", status: "done" });
    const b = task({ id: "b", depends_on: [ref(a)] });
    const l = flowLayout([a, b]);
    expect(l.critical.has("a")).toBe(true);
    expect(l.critical.has("b")).toBe(true);
  });
});

describe("line decomposition and lane packing", () => {
  it("trunk is the critical chain, in step order, on lane 0", () => {
    const m = chain("a", "b", "c");
    const l = flowLayout([...m.values()]);
    expect(l.lines[0].ids).toEqual(["a", "b", "c"]);
    expect(l.lines[0].lane).toBe(0);
    expect(l.lines[0].color).toBe(-1);
  });

  it("the longest remaining chain becomes the next line on the nearest lane", () => {
    const trunk = chain("a", "b", "c", "d");
    const branch = chain("e", "f");
    const l = flowLayout([...trunk.values(), ...branch.values()]);
    expect(l.lines.length).toBe(2);
    expect(l.lines[1].ids).toEqual(["e", "f"]);
    expect(l.lines[1].lane).toBe(-1);
    expect(l.lines[1].color).toBe(0);
  });

  it("a short line PACKS onto an occupied lane when their step ranges are disjoint", () => {
    // Trunk a->b->c->d (steps 0-3). Branch e->f spans steps 0-1 on lane -1.
    // Single g hangs off c (step 3): fits lane -1 beyond the branch's range.
    const trunk = chain("a", "b", "c", "d");
    const branch = chain("e", "f");
    const g = task({ id: "g", depends_on: [ref(trunk.get("c")!)] });
    const l = flowLayout([...trunk.values(), ...branch.values(), g]);
    expect(l.laneOf.get("e")).toBe(-1);
    expect(l.laneOf.get("g")).toBe(-1);
    // ...and the two share a lane but are different lines with different colors.
    const lineE = l.lines[l.lineOf.get("e")!];
    const lineG = l.lines[l.lineOf.get("g")!];
    expect(lineE).not.toBe(lineG);
    expect(lineE.color).not.toBe(lineG.color);
  });

  it("overlapping ranges spill to the next lane instead of packing", () => {
    const trunk = chain("a", "b", "c");
    const b1 = chain("e", "f"); // steps 0-1
    const b2 = chain("x", "y"); // steps 0-1 too
    const l = flowLayout([...trunk.values(), ...b1.values(), ...b2.values()]);
    const lanes = [l.laneOf.get("e"), l.laneOf.get("x")];
    expect(lanes).toContain(-1);
    expect(lanes).toContain(1);
  });

  it("every linked task lands on exactly one line", () => {
    const trunk = chain("a", "b", "c");
    const g = task({ id: "g", depends_on: [ref(trunk.get("a")!)] });
    const h = task({ id: "h", depends_on: [ref(trunk.get("b")!)] });
    const l = flowLayout([...trunk.values(), g, h]);
    const onLines = l.lines.flatMap((ln) => ln.ids).sort();
    expect(onLines).toEqual(["a", "b", "c", "g", "h"]);
  });
});

describe("cycles", () => {
  it("a 3-cycle parks past the last honest step and joins no line as a chain", () => {
    const a = task({ id: "a" });
    const b = task({ id: "b" });
    const c = task({ id: "c" });
    a.depends_on = [ref(c)];
    b.depends_on = [ref(a)];
    c.depends_on = [ref(b)];
    const m = chain("x", "y"); // honest steps 0-1
    const l = flowLayout([a, b, c, ...m.values()]);
    expect(l.cyclic.size).toBe(3);
    expect(l.stepOf.get("a")).toBe(2); // parked past y's step 1
    expect(l.frontier.has("a")).toBe(false);
    expect(l.critical.has("a")).toBe(false);
    // Each cyclic node is its own 1-node line, none painted as trunk.
    for (const id of ["a", "b", "c"]) {
      const line = l.lines[l.lineOf.get(id)!];
      expect(line.ids).toEqual([id]);
      expect(line.color).not.toBe(-1);
    }
  });

  it("a fully cyclic graph parks everyone at step 0 and does not hang", () => {
    const a = task({ id: "a" });
    const b = task({ id: "b" });
    a.depends_on = [ref(b)];
    b.depends_on = [ref(a)];
    const l = flowLayout([a, b]);
    expect(l.cyclic.size).toBe(2);
    expect(l.steps.length).toBe(1);
    expect(l.lines.every((ln) => ln.color !== -1)).toBe(true);
  });
});

describe("stepDues", () => {
  it("per-step latest OPEN due date; done tasks and dateless steps yield null", () => {
    const steps = [
      [task({ due_date: "2026-07-25" }), task({ due_date: "2026-07-30" })],
      [task({ status: "done", due_date: "2026-08-20" }), task()],
      [task({ due_date: "2026-08-08" })],
    ];
    expect(stepDues(steps)).toEqual(["2026-07-30", null, "2026-08-08"]);
  });
});
