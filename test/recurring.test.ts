// An area's list hides recurring tasks that are not due yet. That means this rule
// decides whether a task is visible at all, so the boundary is pinned here: the
// failure mode is a task silently vanishing from the list it belongs in.

import { describe, it, expect } from "vitest";
import type { Task } from "../src/shared/types";
import { isRecurring, isDormant, splitDormantRecurring } from "../src/client/lib/recurring";

const TODAY = "2026-07-16";

const task = (over: Partial<Task> = {}): Task =>
  ({
    id: "t",
    title: "t",
    status: "todo",
    recurrence: null,
    due_date: null,
    planned_date: null,
    scheduled_start: null,
    ...over,
  }) as Task;

const rec = (over: Partial<Task> = {}) =>
  ({ ...task(), recurrence: "every monday", ...over }) as Task;

describe("isRecurring", () => {
  it("is true only with a recurrence spec", () => {
    expect(isRecurring(rec())).toBe(true);
    expect(isRecurring(task({ due_date: TODAY }))).toBe(false);
  });
});

describe("isDormant", () => {
  it("parks a recurring task with no date", () => {
    expect(isDormant(rec(), TODAY)).toBe(true);
  });

  it("parks a recurring task due in the future", () => {
    expect(isDormant(rec({ due_date: "2026-07-20" }), TODAY)).toBe(true);
  });

  // The important direction: a LIVE routine must stay in the list. Hiding a task
  // that is actually due is how you would miss it.
  it("does NOT park one due today", () => {
    expect(isDormant(rec({ due_date: TODAY }), TODAY)).toBe(false);
  });

  it("does NOT park an overdue one", () => {
    expect(isDormant(rec({ due_date: "2026-07-10" }), TODAY)).toBe(false);
  });

  it("does NOT park one planned for today", () => {
    expect(isDormant(rec({ planned_date: TODAY }), TODAY)).toBe(false);
  });

  it("does NOT park one time-blocked today", () => {
    expect(
      isDormant(rec({ scheduled_start: `${TODAY}T09:00:00.000Z` }), TODAY)
    ).toBe(false);
  });

  // A non-recurring task is never parked, whatever its dates: this rule is only
  // ever allowed to touch routines.
  it("never parks a non-recurring task", () => {
    expect(isDormant(task(), TODAY)).toBe(false);
    expect(isDormant(task({ due_date: "2027-01-01" }), TODAY)).toBe(false);
  });
});

describe("splitDormantRecurring", () => {
  it("keeps one-off work and live routines in the list, parks the rest", () => {
    const oneOff = { ...task(), id: "one-off" };
    const liveRoutine = { ...rec({ due_date: TODAY }), id: "live" };
    const waiting = { ...rec({ due_date: "2026-08-01" }), id: "waiting" };
    const noDate = { ...rec(), id: "no-date" };

    const { active, dormant } = splitDormantRecurring(
      [oneOff, liveRoutine, waiting, noDate],
      TODAY
    );
    expect(active.map((t) => t.id)).toEqual(["one-off", "live"]);
    expect(dormant.map((t) => t.id)).toEqual(["waiting", "no-date"]);
  });

  it("loses nothing: every task lands on exactly one side", () => {
    const tasks = [task(), rec(), rec({ due_date: TODAY }), rec({ due_date: "2099-01-01" })];
    const { active, dormant } = splitDormantRecurring(tasks, TODAY);
    expect(active.length + dormant.length).toBe(tasks.length);
  });
});
