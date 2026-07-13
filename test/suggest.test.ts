import { describe, it, expect } from "vitest";
import { suggestForToday } from "../src/shared/suggest";
import type { Task } from "../src/shared/types";

const TODAY = "2026-07-13";

const task = (over: Partial<Task> = {}): Task =>
  ({
    id: "t",
    area_id: null,
    project_id: null,
    title: "T",
    notes: null,
    priority: 3,
    due_date: null,
    due_time: null,
    time_estimate_min: null,
    time_spent_min: 0,
    timer_started_at: null,
    snoozed_until: null,
    planned_date: null,
    scheduled_start: null,
    scheduled_end: null,
    board_column: null,
    section_id: null,
    parent_task_id: null,
    recurring_rule_id: null,
    recurrence: null,
    recurrence_mode: "fixed",
    position: 0,
    status: "todo",
    completed_at: null,
    created_at: "2026-07-01",
    updated_at: "2026-07-01",
    depends_on: [],
    ...over,
  }) as Task;

describe("suggestForToday", () => {
  it("excludes tasks already in Today (planned/blocked/due today/overdue)", () => {
    const tasks = [
      task({ id: "planned", planned_date: TODAY, priority: 1 }),
      task({ id: "blocked-today", scheduled_start: `${TODAY}T09:00:00`, priority: 1 }),
      task({ id: "due-today", due_date: TODAY, priority: 1 }),
      task({ id: "overdue", due_date: "2026-07-10", priority: 1 }),
    ];
    expect(suggestForToday(tasks, TODAY)).toHaveLength(0);
  });

  it("excludes snoozed and dependency-blocked tasks", () => {
    const tasks = [
      task({ id: "snoozed", priority: 1, snoozed_until: "2026-07-20" }),
      task({
        id: "blocked",
        priority: 1,
        depends_on: [{ id: "x", title: "blocker", status: "todo" }],
      }),
    ];
    expect(suggestForToday(tasks, TODAY)).toHaveLength(0);
  });

  it("suggests high-priority tasks with no deadline", () => {
    const [s] = suggestForToday([task({ id: "p1", priority: 1 })], TODAY);
    expect(s.task.id).toBe("p1");
    expect(s.reason).toBe("P1 · urgent");
  });

  it("still suggests low-priority backlog when it is the best available", () => {
    // The button exists for an empty Today — never come back empty-handed if
    // there is anything workable.
    const [s] = suggestForToday([task({ id: "p4", priority: 4 })], TODAY);
    expect(s.task.id).toBe("p4");
    expect(s.reason).toBe("P4 · no deadline");
  });

  it("returns empty only when nothing is eligible", () => {
    const tasks = [
      task({ id: "done", priority: 1, status: "done" }),
      task({ id: "planned", priority: 1, planned_date: TODAY }),
      task({ id: "snoozed", priority: 1, snoozed_until: "2026-07-20" }),
    ];
    expect(suggestForToday(tasks, TODAY)).toHaveLength(0);
  });

  it("suggests a due-soon task even at low priority, with a due reason", () => {
    const [s] = suggestForToday([task({ id: "soon", priority: 4, due_date: "2026-07-14" })], TODAY);
    expect(s.task.id).toBe("soon");
    expect(s.reason).toBe("Due tomorrow");
  });

  it("ranks deadline pressure over priority, priority over backlog, and respects the limit", () => {
    const tasks = [
      task({ id: "p2", priority: 2 }), //            score 30 (no deadline)
      task({ id: "p1-tomorrow", priority: 1, due_date: "2026-07-14" }), // 80
      task({ id: "p3-soon", priority: 3, due_date: "2026-07-15" }), //     50
      task({ id: "p4-backlog", priority: 4 }), //    score 10 (still included)
    ];
    // Pressure first, then priority; the P4 backlog trails but is not dropped.
    expect(suggestForToday(tasks, TODAY).map((s) => s.task.id)).toEqual([
      "p1-tomorrow",
      "p3-soon",
      "p2",
      "p4-backlog",
    ]);
    expect(suggestForToday(tasks, TODAY, 2).map((s) => s.task.id)).toEqual([
      "p1-tomorrow",
      "p3-soon",
    ]);
  });
});
