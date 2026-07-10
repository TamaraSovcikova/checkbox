import { describe, it, expect } from "vitest";
import { resolveDrop } from "../src/client/lib/dnd";
import type { Task } from "../src/shared/types";

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
