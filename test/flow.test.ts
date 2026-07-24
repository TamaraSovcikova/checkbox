// Flow layout: the pure layering behind the project Flow tab (shared/flow).
// Layer by full graph, frontier by blocker status, critical path by estimate,
// cycles parked instead of hanging.

import { describe, it, expect } from "vitest";
import { flowLayout, dateRail, zoneLabel } from "../src/shared/flow";
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

describe("flowLayout layering", () => {
  it("a linear chain gets one step per task, in order", () => {
    const m = chain("a", "b", "c");
    const l = flowLayout([...m.values()]);
    expect(l.steps.map((s) => s.map((t) => t.id))).toEqual([["a"], ["b"], ["c"]]);
  });

  it("a diamond layers by longest path", () => {
    // a -> b -> d, a -> c -> d
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

  it("no dependencies at all: one wide step, sorted by due then priority", () => {
    const l = flowLayout([
      task({ id: "later", due_date: "2026-08-01" }),
      task({ id: "none", priority: 1 }),
      task({ id: "soon", due_date: "2026-07-25" }),
    ]);
    expect(l.steps.length).toBe(1);
    expect(l.steps[0].map((t) => t.id)).toEqual(["soon", "later", "none"]);
    expect(l.edges).toEqual([]);
  });

  it("done blockers do NOT move a task's column (paint, not position)", () => {
    const a = task({ id: "a", status: "done" });
    const b = task({ id: "b", depends_on: [ref(a)] });
    const l = flowLayout([a, b]);
    expect(l.stepOf.get("b")).toBe(1);
  });

  it("a dep pointing outside the set affects frontier but not layout", () => {
    const outside: TaskRef = { id: "elsewhere", title: "x", status: "todo" };
    const t = task({ id: "t", depends_on: [outside] });
    const l = flowLayout([t]);
    expect(l.stepOf.get("t")).toBe(0);
    expect(l.frontier.has("t")).toBe(false);
    expect(l.edges).toEqual([]);
  });
});

describe("flowLayout frontier", () => {
  it("open with all blockers done = frontier; any open blocker = not", () => {
    const a = task({ id: "a", status: "done" });
    const b = task({ id: "b", depends_on: [ref(a)] });
    const c = task({ id: "c", depends_on: [ref(b)] });
    const l = flowLayout([a, b, c]);
    expect(l.frontier.has("a")).toBe(false); // done
    expect(l.frontier.has("b")).toBe(true);
    expect(l.frontier.has("c")).toBe(false);
  });

  it("no blockers and open = frontier", () => {
    const l = flowLayout([task({ id: "solo" })]);
    expect(l.frontier.has("solo")).toBe(true);
  });
});

describe("flowLayout critical path", () => {
  it("no estimates anywhere: longest chain by hops wins", () => {
    // a -> b -> c (3 hops) vs x -> y (2 hops)
    const m = chain("a", "b", "c");
    const n = chain("x", "y");
    const l = flowLayout([...m.values(), ...n.values()]);
    expect([...l.critical].sort()).toEqual(["a", "b", "c"]);
    const critEdges = l.edges.filter((e) => e.critical);
    expect(critEdges.map((e) => `${e.from}>${e.to}`).sort()).toEqual(["a>b", "b>c"]);
  });

  it("with estimates, a heavier short chain beats a longer light one", () => {
    const m = chain("a", "b", "c"); // 30 + 30 + 30 default weights
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

describe("flowLayout cycles", () => {
  it("a 3-cycle parks its members past the last honest step, badged", () => {
    const a = task({ id: "a" });
    const b = task({ id: "b" });
    const c = task({ id: "c" });
    a.depends_on = [ref(c)];
    b.depends_on = [ref(a)];
    c.depends_on = [ref(b)];
    const solo = task({ id: "solo" });
    const l = flowLayout([a, b, c, solo]);
    expect(l.cyclic.size).toBe(3);
    expect(l.stepOf.get("a")).toBe(1); // parked past solo's step 0
    expect(l.frontier.has("a")).toBe(false);
    expect(l.critical.has("a")).toBe(false);
  });

  it("a fully cyclic graph parks everyone at step 0 and does not hang", () => {
    const a = task({ id: "a" });
    const b = task({ id: "b" });
    a.depends_on = [ref(b)];
    b.depends_on = [ref(a)];
    const l = flowLayout([a, b]);
    expect(l.cyclic.size).toBe(2);
    expect(l.steps.length).toBe(1);
  });
});

describe("dateRail", () => {
  const TODAY = "2026-07-24"; // a Friday

  it("labels weeks and months and merges adjacent equal zones", () => {
    expect(zoneLabel("2026-07-26", TODAY)).toBe("this week"); // Sunday same ISO week
    expect(zoneLabel("2026-07-27", TODAY)).toBe("next week"); // Monday
    expect(zoneLabel("2026-08-09", TODAY)).toBe("August");
    const steps = [
      [task({ due_date: "2026-07-25" })],
      [task({ due_date: "2026-07-26" })],
      [task({ due_date: "2026-07-30" })],
      [task({ due_date: "2026-08-08" })],
    ];
    expect(dateRail(steps, TODAY)).toEqual([
      { label: "this week", fromStep: 0, toStep: 1 },
      { label: "next week", fromStep: 2, toStep: 2 },
      { label: "August", fromStep: 3, toStep: 3 },
    ]);
  });

  it("overdue counts as this week, done tasks and dateless steps carry no label", () => {
    expect(zoneLabel("2026-07-10", TODAY)).toBe("this week");
    const steps = [
      [task({ due_date: "2026-07-25" })],
      [task({ status: "done", due_date: "2026-08-20" }), task()],
    ];
    // Step 1 has no OPEN due date, so the first zone extends over it.
    expect(dateRail(steps, TODAY)).toEqual([
      { label: "this week", fromStep: 0, toStep: 1 },
    ]);
  });

  it("no dates at all: empty rail", () => {
    expect(dateRail([[task()], [task()]], TODAY)).toEqual([]);
  });
});
