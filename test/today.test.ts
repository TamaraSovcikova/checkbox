import { describe, it, expect } from "vitest";
import { inToday, leaveTodayBody, undoLeaveTodayBody } from "../src/client/lib/today";
import type { Task } from "../src/shared/types";

const TODAY = "2026-07-15";

const task = (over: Partial<Task> = {}): Task =>
  ({
    id: "t1",
    area_id: null,
    project_id: null,
    title: "T",
    planned_date: null,
    due_date: null,
    due_time: null,
    scheduled_start: null,
    scheduled_end: null,
    status: "todo",
    priority: 3,
    position: 0,
    ...over,
  }) as Task;

describe("inToday — every reason a task surfaces in Today", () => {
  it("planned for today", () => {
    expect(inToday(task({ planned_date: TODAY }), TODAY)).toBe(true);
  });
  it("due today or overdue", () => {
    expect(inToday(task({ due_date: TODAY }), TODAY)).toBe(true);
    expect(inToday(task({ due_date: "2026-07-10" }), TODAY)).toBe(true);
  });
  it("time-blocked today", () => {
    expect(inToday(task({ scheduled_start: `${TODAY}T09:00:00` }), TODAY)).toBe(true);
  });
  it("a future due date or plan is NOT in today", () => {
    expect(inToday(task({ due_date: "2026-07-20" }), TODAY)).toBe(false);
    expect(inToday(task({ planned_date: "2026-07-20" }), TODAY)).toBe(false);
    expect(inToday(task(), TODAY)).toBe(false);
  });
});

describe("leaveTodayBody — clears every trigger, nothing else", () => {
  it("clears an explicit plan", () => {
    expect(leaveTodayBody(task({ planned_date: TODAY }), TODAY)).toEqual({
      planned_date: null,
    });
  });
  it("clears a today/overdue deadline (and its time)", () => {
    expect(
      leaveTodayBody(task({ due_date: TODAY, due_time: "15:00" }), TODAY)
    ).toEqual({ due_date: null, due_time: null });
    expect(leaveTodayBody(task({ due_date: "2026-07-01" }), TODAY)).toEqual({
      due_date: null,
    });
  });
  it("unschedules a today time-block", () => {
    expect(
      leaveTodayBody(
        task({ scheduled_start: `${TODAY}T09:00:00`, scheduled_end: `${TODAY}T10:00:00` }),
        TODAY
      )
    ).toEqual({ scheduled_start: null, scheduled_end: null });
  });
  it("clears all triggers at once but leaves area/project alone", () => {
    const t = task({
      area_id: "a1",
      project_id: "p1",
      planned_date: TODAY,
      due_date: TODAY,
      scheduled_start: `${TODAY}T09:00:00`,
      scheduled_end: `${TODAY}T10:00:00`,
    });
    const body = leaveTodayBody(t, TODAY);
    expect(body).toEqual({
      planned_date: null,
      due_date: null,
      scheduled_start: null,
      scheduled_end: null,
    });
    expect("area_id" in body).toBe(false);
    expect("project_id" in body).toBe(false);
  });
  it("does NOT touch a future deadline", () => {
    expect(leaveTodayBody(task({ due_date: "2026-07-20" }), TODAY)).toEqual({});
  });
});

describe("undoLeaveTodayBody — restores exactly the changed fields", () => {
  it("mirrors the changed keys back to their old values", () => {
    const t = task({ planned_date: TODAY, due_date: TODAY, due_time: "15:00" });
    const body = leaveTodayBody(t, TODAY);
    expect(undoLeaveTodayBody(t, body)).toEqual({
      planned_date: TODAY,
      due_date: TODAY,
      due_time: "15:00",
    });
  });
});
