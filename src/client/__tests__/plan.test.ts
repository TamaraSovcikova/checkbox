import { describe, it, expect } from "vitest";
import { planDay } from "../lib/plan";
import type { CalendarEvent, Task } from "../../shared/types";

// Minimal task factory — only the fields the scheduler reads.
function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    area_id: null,
    project_id: null,
    title: id,
    notes: null,
    priority: 4,
    due_date: null,
    due_time: null,
    time_estimate_min: 60,
    time_spent_min: 0,
    timer_started_at: null,
    snoozed_until: null,
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
    created_at: "2026-07-07",
    updated_at: "2026-07-07",
    ...over,
  };
}

// Fixed "now" at 09:00 local so the window is the full 9–18 work day.
function at(h: number, m = 0) {
  const d = new Date("2026-07-07T09:00:00");
  d.setHours(h, m, 0, 0);
  return d;
}

describe("planDay", () => {
  it("schedules tasks back-to-back from the window start", () => {
    const res = planDay(
      [task("a", { time_estimate_min: 60 }), task("b", { time_estimate_min: 30 })],
      [],
      { now: at(9), workStartHour: 9, workEndHour: 18 }
    );
    expect(res.slots).toHaveLength(2);
    expect(res.slots[0].start.getHours()).toBe(9);
    expect(res.slots[0].end.getHours()).toBe(10);
    // second task starts where the first ended
    expect(res.slots[1].start.getTime()).toBe(res.slots[0].end.getTime());
  });

  it("routes tasks around a calendar meeting", () => {
    const meeting: CalendarEvent = {
      id: "e1",
      gcal_event_id: "e1",
      calendar_id: "c",
      title: "Standup",
      start: at(9, 30).toISOString(),
      end: at(10, 30).toISOString(),
      all_day: false,
      is_checkbox_owned: false,
      task_id: null,
    };
    const res = planDay([task("a", { time_estimate_min: 60 })], [meeting], {
      now: at(9),
      workStartHour: 9,
      workEndHour: 18,
    });
    // Can't fit a 60-min task in the 9:00–9:30 gap, so it lands after the meeting.
    expect(res.slots).toHaveLength(1);
    expect(res.slots[0].start.getTime()).toBe(at(10, 30).getTime());
  });

  it("prioritises P1 over P4 when placing", () => {
    const res = planDay(
      [
        task("low", { priority: 4, time_estimate_min: 60 }),
        task("high", { priority: 1, time_estimate_min: 60 }),
      ],
      [],
      { now: at(9), workStartHour: 9, workEndHour: 18 }
    );
    expect(res.slots[0].task.id).toBe("high");
  });

  it("marks tasks that don't fit the remaining day as unscheduled", () => {
    // Two 5-hour tasks can't both fit a 9-hour window.
    const res = planDay(
      [
        task("a", { time_estimate_min: 300 }),
        task("b", { time_estimate_min: 300 }),
      ],
      [],
      { now: at(9), workStartHour: 9, workEndHour: 18 }
    );
    expect(res.slots).toHaveLength(1);
    expect(res.unscheduled).toHaveLength(1);
  });

  it("treats an already time-blocked task as busy, not schedulable", () => {
    const blocked = task("blocked", {
      scheduled_start: at(9).toISOString(),
      scheduled_end: at(11).toISOString(),
    });
    const res = planDay([blocked, task("a", { time_estimate_min: 60 })], [], {
      now: at(9),
      workStartHour: 9,
      workEndHour: 18,
    });
    // Only "a" gets scheduled, and it starts after the existing block.
    expect(res.slots).toHaveLength(1);
    expect(res.slots[0].task.id).toBe("a");
    expect(res.slots[0].start.getTime()).toBeGreaterThanOrEqual(at(11).getTime());
  });
});
