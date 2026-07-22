import { describe, it, expect } from "vitest";
import {
  inToday,
  inTodayView,
  hasSubtaskDueToday,
  subtasksDueBy,
  leaveTodayBody,
  undoLeaveTodayBody,
  stalePlannedTasks,
  hasCheckpointDue,
} from "../src/client/lib/today";
import type { Subtask, Task } from "../src/shared/types";

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
  // The carry-forward: a plan from an earlier day, still open, stays in Today
  // rather than vanishing at midnight.
  it("planned for an EARLIER day and not done", () => {
    expect(inToday(task({ planned_date: "2026-07-14" }), TODAY)).toBe(true);
    expect(inToday(task({ planned_date: "2026-07-01" }), TODAY)).toBe(true);
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

describe("checkpoints carry a task into Today", () => {
  it("a due checkpoint puts the task in the view but NOT inToday's own reasons", () => {
    const t = task({ due_date: "2026-09-01", checkpoint_next: TODAY });
    expect(inTodayView(t, TODAY)).toBe(true);
    // Not a toggle reason (leaveTodayBody cannot clear a checkpoint).
    expect(inToday(t, TODAY)).toBe(false);
  });

  it("an overdue checkpoint counts", () => {
    expect(hasCheckpointDue(task({ checkpoint_next: "2026-07-01" }), TODAY)).toBe(true);
  });

  it("a future checkpoint does not", () => {
    expect(hasCheckpointDue(task({ checkpoint_next: "2026-08-01" }), TODAY)).toBe(false);
  });

  it("no checkpoint does not", () => {
    expect(hasCheckpointDue(task(), TODAY)).toBe(false);
  });
});

describe("stalePlannedTasks", () => {
  const old = "2026-06-20"; // 25 days before TODAY (2026-07-15)
  const recent = "2026-07-10"; // 5 days before, not yet stale

  it("flags a task planned long ago with nothing else keeping it in Today", () => {
    expect(stalePlannedTasks([task({ planned_date: old })], TODAY).length).toBe(1);
  });

  it("does not flag a recently planned task", () => {
    expect(stalePlannedTasks([task({ planned_date: recent })], TODAY)).toEqual([]);
  });

  it("respects the threshold boundary (>= days, not >)", () => {
    // TODAY is 2026-07-15, so 14 days back is 2026-07-01 (stale); 13 back is not.
    expect(stalePlannedTasks([task({ planned_date: "2026-07-01" })], TODAY).length).toBe(1);
    expect(stalePlannedTasks([task({ planned_date: "2026-07-02" })], TODAY)).toEqual([]);
  });

  // Excluded because clearing the plan would NOT drop them out of Today: they are
  // there for another reason, so nagging about the plan is wrong.
  it("ignores a stale plan that is ALSO due/overdue", () => {
    expect(
      stalePlannedTasks([task({ planned_date: old, due_date: "2026-07-01" })], TODAY)
    ).toEqual([]);
  });

  it("ignores a stale plan that is ALSO time-blocked today", () => {
    expect(
      stalePlannedTasks(
        [task({ planned_date: old, scheduled_start: `${TODAY}T09:00:00` })],
        TODAY
      )
    ).toEqual([]);
  });

  it("ignores a done task", () => {
    expect(
      stalePlannedTasks([task({ planned_date: old, status: "done" })], TODAY)
    ).toEqual([]);
  });

  it("returns nothing for a task with no plan", () => {
    expect(stalePlannedTasks([task({ due_date: "2026-07-01" })], TODAY)).toEqual([]);
  });

  it("survives a DST boundary in the day count", () => {
    // Around Brussels spring-forward: 15 days before 2026-04-12 is 2026-03-28.
    expect(stalePlannedTasks([task({ planned_date: "2026-03-28" })], "2026-04-12").length).toBe(1);
  });
});

describe("leaveTodayBody clears a carried-over plan", () => {
  it("clears a plan from an earlier day, not just today's", () => {
    expect(leaveTodayBody(task({ planned_date: "2026-07-10" }), TODAY)).toEqual({
      planned_date: null,
    });
  });
});

// A task can owe work today through one of its STEPS while the task itself is not
// due for weeks. The Today VIEW holds those; inToday deliberately does not.
const sub = (over: Partial<Subtask> = {}): Subtask => ({
  id: "s1",
  task_id: "t1",
  title: "S",
  done: false,
  position: 0,
  due_date: null,
  priority: null,
  ...over,
});

describe("subtasks carry a task into Today", () => {
  const farOff = { due_date: "2026-09-01" }; // the task itself is not due

  it("an open subtask due today or overdue puts the task in the view", () => {
    expect(
      inTodayView(task({ ...farOff, subtasks: [sub({ due_date: TODAY })] }), TODAY)
    ).toBe(true);
    expect(
      inTodayView(task({ ...farOff, subtasks: [sub({ due_date: "2026-07-01" })] }), TODAY)
    ).toBe(true);
  });

  it("a DONE subtask does not, however overdue", () => {
    expect(
      hasSubtaskDueToday(
        task({ ...farOff, subtasks: [sub({ due_date: "2026-07-01", done: true })] }),
        TODAY
      )
    ).toBe(false);
  });

  it("a future or undated subtask does not", () => {
    expect(
      hasSubtaskDueToday(task({ ...farOff, subtasks: [sub({ due_date: "2026-07-20" })] }), TODAY)
    ).toBe(false);
    expect(hasSubtaskDueToday(task({ ...farOff, subtasks: [sub()] }), TODAY)).toBe(false);
    expect(hasSubtaskDueToday(task(farOff), TODAY)).toBe(false);
  });

  // The whole reason the two rules are separate: the toggle is bound to inToday,
  // and leaveTodayBody cannot clear a subtask's due date. If a subtask made
  // inToday true, the row would offer a Remove that silently does nothing.
  it("does NOT make the task inToday on its own account", () => {
    const t = task({ ...farOff, subtasks: [sub({ due_date: TODAY })] });
    expect(inToday(t, TODAY)).toBe(false);
    expect(leaveTodayBody(t, TODAY)).toEqual({});
  });

  it("returns the due subtasks themselves, for the row to name them", () => {
    const t = task({
      ...farOff,
      subtasks: [
        sub({ id: "a", title: "post the form", due_date: TODAY }),
        sub({ id: "b", title: "later", due_date: "2026-08-01" }),
        sub({ id: "c", title: "done already", due_date: TODAY, done: true }),
      ],
    });
    expect(subtasksDueBy(t, TODAY).map((s) => s.title)).toEqual(["post the form"]);
  });

  it("a task already in Today on its own account stays in, subtasks or not", () => {
    expect(inTodayView(task({ due_date: TODAY }), TODAY)).toBe(true);
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
