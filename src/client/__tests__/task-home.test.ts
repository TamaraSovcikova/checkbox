// Where the task sheet's Navigate button sends you.
//
// The one thing this must never do is land on a page that does not contain the
// task: an "open it where it lives" button that opens a list without it in is
// worse than no button. The Backlog case is the trap, because that view
// deliberately excludes anything planned for today.

import { describe, it, expect } from "vitest";
import { taskHomePath } from "../lib/use-focus-task";
import type { Task } from "../../shared/types";

const TODAY = "2026-08-25";

const task = (over: Partial<Task>): Task =>
  ({
    id: "t1",
    area_id: null,
    project_id: null,
    title: "x",
    status: "todo",
    priority: 4,
    due_date: null,
    planned_date: null,
    scheduled_start: null,
    snoozed_until: null,
    checkpoint_next: null,
    subtasks: [],
    ...over,
  }) as Task;

describe("taskHomePath", () => {
  it("prefers the project: the most specific home a task has", () => {
    expect(taskHomePath(task({ project_id: "p1", area_id: "a1" }), TODAY)).toBe(
      "/project/p1?focus=t1"
    );
  });

  it("falls back to the area when there is no project", () => {
    expect(taskHomePath(task({ area_id: "a1" }), TODAY)).toBe("/area/a1?focus=t1");
  });

  it("sends an unfiled task to the Backlog", () => {
    expect(taskHomePath(task({}), TODAY)).toBe("/backlog?focus=t1");
  });

  it("sends an unfiled task PLANNED FOR TODAY to Today, since the Backlog hides those", () => {
    expect(taskHomePath(task({ planned_date: TODAY }), TODAY)).toBe("/today?focus=t1");
  });

  it("sends an unfiled task due today to Today for the same reason", () => {
    expect(taskHomePath(task({ due_date: TODAY }), TODAY)).toBe("/today?focus=t1");
  });
});
