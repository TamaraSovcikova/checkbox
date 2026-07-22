import { describe, it, expect } from "vitest";
import { resolveDrop, computeProjectReorder } from "../src/client/lib/dnd";
import type { Project, Task } from "../src/shared/types";

const task = (over: Partial<Task> = {}): Task =>
  ({
    id: "t1",
    area_id: null,
    project_id: null,
    title: "T",
    notes: null,
    priority: 3,
    due_date: null,
    due_time: null,
    time_estimate_min: null,
    scheduled_start: null,
    scheduled_end: null,
    board_column: null,
    section_id: null,
    parent_task_id: null,
    recurring_rule_id: null,
    position: 0,
    status: "todo",
    completed_at: null,
    created_at: "2026-07-01",
    updated_at: "2026-07-01",
    ...over,
  }) as Task;

const drag = { type: "task", task: task() };
const TODAY = "2026-07-03";

describe("resolveDrop", () => {
  it("returns null for missing task or target", () => {
    expect(resolveDrop(undefined, { type: "area" }, TODAY)).toBeNull();
    expect(resolveDrop(drag, undefined, TODAY)).toBeNull();
    expect(resolveDrop(drag, { type: "mystery" }, TODAY)).toBeNull();
  });

  it("area drop sets area and clears project", () => {
    expect(resolveDrop(drag, { type: "area", areaId: "a1" }, TODAY)).toEqual({
      kind: "update",
      id: "t1",
      body: { area_id: "a1", project_id: null },
    });
  });

  it("project drop sets project + its area", () => {
    expect(
      resolveDrop(drag, { type: "project", projectId: "p1", areaId: "a1" }, TODAY)
    ).toEqual({
      kind: "update",
      id: "t1",
      body: { project_id: "p1", area_id: "a1" },
    });
  });

  it("column drop sets board_column; last column marks done", () => {
    expect(
      resolveDrop(drag, { type: "column", column: "Doing", done: false }, TODAY)
    ).toEqual({ kind: "update", id: "t1", body: { board_column: "Doing", status: "todo" } });
    expect(
      resolveDrop(drag, { type: "column", column: "Done", done: true }, TODAY)
    ).toEqual({ kind: "update", id: "t1", body: { board_column: "Done", status: "done" } });
  });

  it("column drop preserves `doing`, which subtask progress sets", () => {
    const doingDrag = { type: "task", task: task({ status: "doing" }) };
    expect(
      resolveDrop(doingDrag, { type: "column", column: "Backlog", done: false }, TODAY)
    ).toEqual({
      kind: "update",
      id: "t1",
      body: { board_column: "Backlog", status: "doing" },
    });
  });

  it("dragging a done task out of the done column revives it as todo", () => {
    const doneDrag = { type: "task", task: task({ status: "done" }) };
    expect(
      resolveDrop(doneDrag, { type: "column", column: "Doing", done: false }, TODAY)
    ).toEqual({
      kind: "update",
      id: "t1",
      body: { board_column: "Doing", status: "todo" },
    });
  });

  // The Today board's stage columns map straight to task.status.
  it("stage drop to doing sets status doing", () => {
    expect(resolveDrop(drag, { type: "stage", stage: "doing" }, TODAY)).toEqual({
      kind: "update",
      id: "t1",
      body: { status: "doing" },
    });
  });

  it("stage drop to the same status is a no-op", () => {
    expect(resolveDrop(drag, { type: "stage", stage: "todo" }, TODAY)).toBeNull();
  });

  it("stage drop to done completes via the complete endpoint", () => {
    expect(resolveDrop(drag, { type: "stage", stage: "done" }, TODAY)).toEqual({
      kind: "complete",
      id: "t1",
      done: true,
    });
  });

  it("stage: dragging a done task to doing reopens it, then marks doing", () => {
    const doneDrag = { type: "task", task: task({ status: "done" }) };
    expect(resolveDrop(doneDrag, { type: "stage", stage: "doing" }, TODAY)).toEqual({
      kind: "complete",
      id: "t1",
      done: false,
      then: { status: "doing" },
    });
  });

  it("stage: dragging a done task to todo just reopens it", () => {
    const doneDrag = { type: "task", task: task({ status: "done" }) };
    expect(resolveDrop(doneDrag, { type: "stage", stage: "todo" }, TODAY)).toEqual({
      kind: "complete",
      id: "t1",
      done: false,
      then: undefined,
    });
  });

  it("stage: a done task dropped back on done is a no-op", () => {
    const doneDrag = { type: "task", task: task({ status: "done" }) };
    expect(resolveDrop(doneDrag, { type: "stage", stage: "done" }, TODAY)).toBeNull();
  });

  it("slot drop schedules using the task's estimate (default 60m)", () => {
    const action = resolveDrop(
      { type: "task", task: task({ time_estimate_min: 90 }) },
      { type: "slot", date: "2026-07-03", time: "09:00" },
      TODAY
    );
    expect(action).toEqual({
      kind: "update",
      id: "t1",
      body: { scheduled_start: "2026-07-03T09:00:00", scheduled_end: "2026-07-03T10:30:00" },
    });
  });

  it("slot drop defaults to a 60-minute block", () => {
    const action = resolveDrop(drag, { type: "slot", date: "2026-07-03", time: "14:00" }, TODAY);
    expect(action).toMatchObject({
      body: { scheduled_start: "2026-07-03T14:00:00", scheduled_end: "2026-07-03T15:00:00" },
    });
  });

  it("moving an already-scheduled block preserves its duration", () => {
    const scheduled = task({
      scheduled_start: "2026-07-03T09:00:00",
      scheduled_end: "2026-07-03T10:30:00", // 90-minute block
      time_estimate_min: 30, // must be ignored in favour of the real duration
    });
    const action = resolveDrop(
      { type: "task", task: scheduled },
      { type: "slot", date: "2026-07-03", time: "13:00" },
      TODAY
    );
    expect(action).toEqual({
      kind: "update",
      id: "t1",
      body: { scheduled_start: "2026-07-03T13:00:00", scheduled_end: "2026-07-03T14:30:00" },
    });
  });

  it("view:today plans for today (not a deadline); view:backlog clears area+project", () => {
    expect(resolveDrop(drag, { type: "view", view: "today" }, TODAY)).toEqual({
      kind: "update",
      id: "t1",
      body: { planned_date: TODAY },
    });
    expect(resolveDrop(drag, { type: "view", view: "backlog" }, TODAY)).toEqual({
      kind: "update",
      id: "t1",
      body: { area_id: null, project_id: null },
    });
  });
});

describe("resolveDrop — dragging a project", () => {
  const project = (over: Partial<Project> = {}): Project =>
    ({
      id: "p1",
      area_id: "a1",
      name: "Proj",
      description: null,
      goal: null,
      status: "active",
      start_date: null,
      due_date: null,
      board_columns: [],
      position: 0,
      completed_at: null,
      ...over,
    }) as Project;

  const dragProject = { type: "move-project", project: project() };

  it("dropping a project on a different area moves it there", () => {
    expect(
      resolveDrop(dragProject, { type: "area", areaId: "a2" }, TODAY)
    ).toEqual({ kind: "move-project", id: "p1", areaId: "a2" });
  });

  it("dropping a project on its own area is a no-op", () => {
    expect(resolveDrop(dragProject, { type: "area", areaId: "a1" }, TODAY)).toBeNull();
  });

  it("dropping a project on another project in the SAME area reorders", () => {
    expect(
      resolveDrop(dragProject, { type: "project", projectId: "p2", areaId: "a1" }, TODAY)
    ).toEqual({ kind: "reorder-project", id: "p1", overId: "p2" });
  });

  it("dropping a project on a project in a DIFFERENT area does nothing", () => {
    // Re-homing is the area-drop's job; grazing another area's card must not
    // silently move the project.
    expect(
      resolveDrop(dragProject, { type: "project", projectId: "p2", areaId: "a2" }, TODAY)
    ).toBeNull();
  });

  it("dropping a project on itself is a no-op", () => {
    expect(
      resolveDrop(dragProject, { type: "project", projectId: "p1", areaId: "a1" }, TODAY)
    ).toBeNull();
  });

  it("a project never drops on views or slots", () => {
    expect(resolveDrop(dragProject, { type: "view", view: "today" }, TODAY)).toBeNull();
    expect(
      resolveDrop(dragProject, { type: "slot", date: "2026-07-20", time: "09:00" }, TODAY)
    ).toBeNull();
  });
});

describe("computeProjectReorder", () => {
  const p = (id: string, area: string, pos: number): Project =>
    ({
      id,
      area_id: area,
      name: id,
      description: null,
      goal: null,
      status: "active",
      start_date: null,
      due_date: null,
      board_columns: [],
      position: pos,
      completed_at: null,
    }) as Project;

  // a1: [A, B, C]; a2: [X] (must never be touched by an a1 reorder).
  const all = [p("A", "a1", 0), p("B", "a1", 1), p("C", "a1", 2), p("X", "a2", 0)];

  it("moves a project down and renumbers the area densely", () => {
    // A dropped onto C -> [B, C, A]
    expect(computeProjectReorder(all, "A", "C")).toEqual([
      { id: "B", position: 0 },
      { id: "C", position: 1 },
      { id: "A", position: 2 },
    ]);
  });

  it("moves a project up", () => {
    // C dropped onto A -> [C, A, B]
    expect(computeProjectReorder(all, "C", "A")).toEqual([
      { id: "C", position: 0 },
      { id: "A", position: 1 },
      { id: "B", position: 2 },
    ]);
  });

  it("only ever renumbers the dragged project's own area", () => {
    const out = computeProjectReorder(all, "A", "C");
    expect(out.some((r) => r.id === "X")).toBe(false);
  });

  it("is a no-op onto itself or an unknown target", () => {
    expect(computeProjectReorder(all, "A", "A")).toEqual([]);
    expect(computeProjectReorder(all, "A", "nope")).toEqual([]);
    expect(computeProjectReorder(all, "ghost", "C")).toEqual([]);
  });
});
