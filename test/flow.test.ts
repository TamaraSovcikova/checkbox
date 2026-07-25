// Runway layout (shared/flow): the pure computation behind the Flow tab.
// Ready line at depth 0, blocked work receding by visible-dependency depth,
// spine, ad-hoc shelf, bare-names row, and the daily reset emerging from
// done-today visibility rather than stored state.

import { describe, it, expect } from "vitest";
import { runwayLayout, isOverdue } from "../src/shared/flow";
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
    created_at: "2026-07-01T10:00:00Z",
    depends_on: [],
    blocks: [],
    ...over,
  }) as Task;

// a -> b means b depends on a (and a knows it blocks b).
function chain(...ids: string[]): Map<string, Task> {
  const m = new Map<string, Task>();
  for (const id of ids) m.set(id, task({ id }));
  for (let i = 1; i < ids.length; i++) {
    m.get(ids[i])!.depends_on = [ref(m.get(ids[i - 1])!)];
    m.get(ids[i - 1])!.blocks = [ref(m.get(ids[i])!)];
  }
  return m;
}

describe("grouping: flow vs ad-hoc vs bare names", () => {
  it("splits by dependency relationships and due dates", () => {
    const m = chain("a", "b");
    const dated = task({ id: "dated", due_date: "2026-08-01" });
    const bare = task({ id: "bare" });
    const l = runwayLayout([...m.values(), dated, bare]);
    expect(l.slots.flat().map((t) => t.id).sort()).toEqual(["a", "b"]);
    expect(l.adhoc.map((t) => t.id)).toEqual(["dated"]);
    expect(l.names.map((t) => t.id)).toEqual(["bare"]);
  });

  it("a task whose only blocker finished BEFORE today is flow work in the ready line", () => {
    const gone: TaskRef = { id: "gone", title: "old", status: "done" };
    const t = task({ id: "t", depends_on: [gone] });
    const l = runwayLayout([t]);
    expect(l.slots[0].map((x) => x.id)).toEqual(["t"]);
    expect(l.ready.has("t")).toBe(true);
    expect(l.unlockedToday.has("t")).toBe(false);
    expect(l.adhoc).toEqual([]);
  });

  it("a blocker with dependents but no deps of its own is flow, not ad-hoc", () => {
    const m = chain("head", "tail");
    const l = runwayLayout([...m.values()]);
    expect(l.adhoc).toEqual([]);
    expect(l.depthOf.get("head")).toBe(0);
  });

  it("shelf sorts by due then priority; names sort by creation, oldest first", () => {
    const l = runwayLayout([
      task({ id: "late", due_date: "2026-08-10", priority: 1 }),
      task({ id: "soonP2", due_date: "2026-08-01", priority: 2 }),
      task({ id: "soonP1", due_date: "2026-08-01", priority: 1 }),
      task({ id: "old-name", created_at: "2026-07-01T08:00:00Z" }),
      task({ id: "new-name", created_at: "2026-07-20T08:00:00Z" }),
    ]);
    expect(l.adhoc.map((t) => t.id)).toEqual(["soonP1", "soonP2", "late"]);
    expect(l.names.map((t) => t.id)).toEqual(["old-name", "new-name"]);
  });
});

describe("the daily reset, as a visibility consequence", () => {
  it("TODAY: a blocker completed today stays visible, its dependent turns green IN PLACE", () => {
    const a = task({ id: "a", status: "done" }); // completed today, passed in
    const b = task({ id: "b", depends_on: [ref(a)] });
    const l = runwayLayout([a, b]);
    expect(l.depthOf.get("a")).toBe(0);
    expect(l.depthOf.get("b")).toBe(1); // in place, NOT migrated yet
    expect(l.ready.has("b")).toBe(true);
    expect(l.unlockedToday.has("b")).toBe(true);
  });

  it("TOMORROW: the done card is no longer passed in and the dependent wakes up in the ready line", () => {
    const gone: TaskRef = { id: "a", title: "a", status: "done" };
    const b = task({ id: "b", depends_on: [gone] });
    const l = runwayLayout([b]);
    expect(l.depthOf.get("b")).toBe(0); // migrated by pure visibility
    expect(l.ready.has("b")).toBe(true);
    expect(l.unlockedToday.has("b")).toBe(false);
    expect(l.edges).toEqual([]);
  });
});

describe("depth and readiness", () => {
  it("a chain lays out one depth per task; only the head is ready", () => {
    const m = chain("a", "b", "c");
    const l = runwayLayout([...m.values()]);
    expect(l.slots.map((s) => s.map((t) => t.id))).toEqual([["a"], ["b"], ["c"]]);
    expect([...l.ready]).toEqual(["a"]);
  });

  it("a diamond layers by longest path", () => {
    const a = task({ id: "a" });
    const b = task({ id: "b", depends_on: [ref(a)] });
    const c = task({ id: "c", depends_on: [ref(a)] });
    const d = task({ id: "d", depends_on: [ref(b), ref(c)] });
    a.blocks = [ref(b), ref(c)];
    const l = runwayLayout([a, b, c, d]);
    expect(l.depthOf.get("d")).toBe(2);
  });

  it("slots order by due date then priority", () => {
    const a = task({ id: "a", due_date: "2026-08-05" });
    const b = task({ id: "b", due_date: "2026-08-01" });
    const x = task({ id: "x", depends_on: [ref(a)] });
    a.blocks = [ref(x)];
    b.blocks = [ref(x)];
    x.depends_on = [ref(a), ref(b)];
    const l = runwayLayout([a, b, x]);
    expect(l.slots[0].map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("spine", () => {
  it("no estimates: longest chain by hops", () => {
    const m = chain("a", "b", "c");
    const n = chain("x", "y");
    const l = runwayLayout([...m.values(), ...n.values()]);
    expect([...l.spine].sort()).toEqual(["a", "b", "c"]);
    expect(
      l.edges.filter((e) => e.spine).map((e) => `${e.from}>${e.to}`).sort()
    ).toEqual(["a>b", "b>c"]);
  });

  it("with estimates, the heavier short chain wins", () => {
    const m = chain("a", "b", "c");
    const x = task({ id: "x", time_estimate_min: 120 });
    const y = task({ id: "y", time_estimate_min: 120, depends_on: [ref(x)] });
    x.blocks = [ref(y)];
    const l = runwayLayout([...m.values(), x, y]);
    expect([...l.spine].sort()).toEqual(["x", "y"]);
  });

  it("the spine runs through a task completed today", () => {
    const a = task({ id: "a", status: "done" });
    const b = task({ id: "b", depends_on: [ref(a)] });
    a.blocks = [ref(b)];
    const l = runwayLayout([a, b]);
    expect(l.spine.has("a")).toBe(true);
    expect(l.spine.has("b")).toBe(true);
  });
});

describe("cycles", () => {
  it("a 3-cycle parks past the last honest slot, badged, never ready or spine", () => {
    const a = task({ id: "a" });
    const b = task({ id: "b" });
    const c = task({ id: "c" });
    a.depends_on = [ref(c)];
    b.depends_on = [ref(a)];
    c.depends_on = [ref(b)];
    const m = chain("x", "y");
    const l = runwayLayout([a, b, c, ...m.values()]);
    expect(l.cyclic.size).toBe(3);
    expect(l.depthOf.get("a")).toBe(2);
    expect(l.ready.has("a")).toBe(false);
    expect(l.spine.has("a")).toBe(false);
  });

  it("a fully cyclic graph parks at slot 0 and does not hang", () => {
    const a = task({ id: "a" });
    const b = task({ id: "b" });
    a.depends_on = [ref(b)];
    b.depends_on = [ref(a)];
    const l = runwayLayout([a, b]);
    expect(l.cyclic.size).toBe(2);
    expect(l.slots.length).toBe(1);
  });
});

describe("isOverdue", () => {
  const TODAY = "2026-07-25";
  it("open and past due only", () => {
    expect(isOverdue(task({ due_date: "2026-07-24" }), TODAY)).toBe(true);
    expect(isOverdue(task({ due_date: "2026-07-25" }), TODAY)).toBe(false);
    expect(isOverdue(task({ due_date: "2026-07-01", status: "done" }), TODAY)).toBe(false);
    expect(isOverdue(task(), TODAY)).toBe(false);
  });
});
