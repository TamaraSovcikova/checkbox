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
  isSubtaskLed,
  subtasksDueToday,
} from "../src/client/lib/today";
import type { Subtask, Task } from "../src/shared/types";

const TODAY = "2026-07-15";
const TOMORROW = "2026-07-16";

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

  it("an open subtask due EXACTLY today puts the task in the view", () => {
    expect(
      inTodayView(task({ ...farOff, subtasks: [sub({ due_date: TODAY })] }), TODAY)
    ).toBe(true);
  });

  it("an OVERDUE subtask does NOT: past steps are the Overdue view's job", () => {
    // The EuroMeet lesson: with `<=` here, a step due last Friday resurrected
    // the parent in Today every morning forever, surviving every Remove.
    expect(
      inTodayView(task({ ...farOff, subtasks: [sub({ due_date: "2026-07-01" })] }), TODAY)
    ).toBe(false);
    expect(
      hasSubtaskDueToday(task({ ...farOff, subtasks: [sub({ due_date: "2026-07-01" })] }), TODAY)
    ).toBe(false);
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

  // inToday stays the clearable-reasons rule: a subtask's deadline is not the
  // task's own plan/due/schedule. The TOGGLE, though, is bound to inTodayView,
  // and Remove handles a subtask-carried task by snoozing it to tomorrow: the
  // deadline is real data Remove must not delete, but the view must still let
  // go of the task, or the button reads as doing nothing.
  it("does NOT make the task inToday on its own account; Remove snoozes it", () => {
    const t = task({ ...farOff, subtasks: [sub({ due_date: TODAY })] });
    expect(inToday(t, TODAY)).toBe(false);
    expect(leaveTodayBody(t, TODAY)).toEqual({ snoozed_until: TOMORROW });
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

// The rule behind the step-led row: when the ONLY reason a task is in Today is a
// step due today, the row is drawn as that step with the task above it as
// context (TaskRow, BoardCard). Getting this wrong either buries the task's own
// deadline behind a step or prints the step twice, so the boundary is pinned.
describe("isSubtaskLed / subtasksDueToday", () => {
  const farOff = { due_date: "2026-09-01" };

  it("is led by its step when the step is the only reason it is here", () => {
    expect(isSubtaskLed(task({ ...farOff, subtasks: [sub({ due_date: TODAY })] }), TODAY)).toBe(
      true
    );
  });

  it("is NOT led when the task is in Today on its own account too", () => {
    // Planned for today AND carrying a step due today: the task is the work,
    // and the step shows in the checklist under it as before.
    expect(
      isSubtaskLed(task({ planned_date: TODAY, subtasks: [sub({ due_date: TODAY })] }), TODAY)
    ).toBe(false);
    expect(
      isSubtaskLed(task({ due_date: TODAY, subtasks: [sub({ due_date: TODAY })] }), TODAY)
    ).toBe(false);
  });

  it("is NOT led by an overdue or future step", () => {
    expect(
      isSubtaskLed(task({ ...farOff, subtasks: [sub({ due_date: "2026-07-01" })] }), TODAY)
    ).toBe(false);
    expect(
      isSubtaskLed(task({ ...farOff, subtasks: [sub({ due_date: "2026-07-20" })] }), TODAY)
    ).toBe(false);
  });

  it("a done task is never step-led", () => {
    expect(
      isSubtaskLed(
        task({ ...farOff, status: "done", subtasks: [sub({ due_date: TODAY })] }),
        TODAY
      )
    ).toBe(false);
  });

  it("returns every open step due today, in list order", () => {
    const t = task({
      ...farOff,
      subtasks: [
        sub({ id: "a", title: "post the form", due_date: TODAY }),
        sub({ id: "b", title: "book the room", due_date: TODAY }),
        sub({ id: "c", title: "ticked", due_date: TODAY, done: true }),
        sub({ id: "d", title: "later", due_date: "2026-08-01" }),
      ],
    });
    expect(subtasksDueToday(t, TODAY).map((s) => s.title)).toEqual([
      "post the form",
      "book the room",
    ]);
  });

  // subtasksDueBy includes overdue steps (it feeds the "2 subtasks overdue"
  // chip); subtasksDueToday is strictly today, because only a step due TODAY
  // carries the task into Today, so only that step can lead a row.
  it("differs from subtasksDueBy on overdue steps", () => {
    const t = task({
      ...farOff,
      subtasks: [sub({ id: "a", due_date: "2026-07-01" }), sub({ id: "b", due_date: TODAY })],
    });
    expect(subtasksDueBy(t, TODAY).map((s) => s.id)).toEqual(["a", "b"]);
    expect(subtasksDueToday(t, TODAY).map((s) => s.id)).toEqual(["b"]);
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

// The bug this guards against: a task planned for today AND carrying a due
// subtask offered "Remove from Today", cleared the plan, toasted success, and
// stayed in the view via the subtask clause. Remove must clear what it can and
// defer past what it cannot, so the task actually leaves.
describe("leaveTodayBody — mixed reasons: clears what it can, snoozes past the rest", () => {
  it("planned + due subtask: clears the plan AND snoozes to tomorrow", () => {
    const t = task({
      planned_date: TODAY,
      due_date: "2026-09-01",
      subtasks: [sub({ due_date: TODAY })],
    });
    expect(leaveTodayBody(t, TODAY)).toEqual({
      planned_date: null,
      snoozed_until: TOMORROW,
    });
  });
  it("due today + due checkpoint: clears the deadline AND snoozes", () => {
    const t = task({ due_date: TODAY, checkpoint_next: TODAY });
    expect(leaveTodayBody(t, TODAY)).toEqual({
      due_date: null,
      snoozed_until: TOMORROW,
    });
  });
  it("checkpoint only: snoozes, never touches the checkpoint schedule", () => {
    const t = task({ due_date: "2026-09-01", checkpoint_next: "2026-07-10" });
    const body = leaveTodayBody(t, TODAY);
    expect(body).toEqual({ snoozed_until: TOMORROW });
    expect("checkpoint_next" in body).toBe(false);
    expect("checkpoint_days" in body).toBe(false);
  });
  it("no residual reason: no snooze added", () => {
    expect(leaveTodayBody(task({ planned_date: TODAY }), TODAY)).toEqual({
      planned_date: null,
    });
  });
  it("a future checkpoint or future subtask does not trigger the snooze", () => {
    expect(
      leaveTodayBody(
        task({
          planned_date: TODAY,
          checkpoint_next: "2026-07-20",
          subtasks: [sub({ due_date: "2026-07-20" })],
        }),
        TODAY
      )
    ).toEqual({ planned_date: null });
  });
  it("an OVERDUE subtask does not trigger the snooze either: Remove is final", () => {
    expect(
      leaveTodayBody(
        task({ planned_date: TODAY, subtasks: [sub({ due_date: "2026-07-01" })] }),
        TODAY
      )
    ).toEqual({ planned_date: null });
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

  it("a snoozed Remove undoes back to un-snoozed", () => {
    const t = task({ planned_date: TODAY, subtasks: [sub({ due_date: TODAY })] });
    const body = leaveTodayBody(t, TODAY);
    expect(body).toEqual({ planned_date: null, snoozed_until: TOMORROW });
    // The task had no snooze before, so undo must clear the one Remove set,
    // putting the task straight back into the Today view. null, not undefined:
    // undefined would vanish from the PATCH body and leave the snooze standing.
    expect(undoLeaveTodayBody(t, body)).toEqual({
      planned_date: TODAY,
      snoozed_until: null,
    });
  });
});
