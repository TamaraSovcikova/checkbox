// Regression: converting a Google event between all-day and timed via PATCH must
// null the opposite representation, or Google merges the objects and rejects the
// update with 400 "Invalid start time." (This broke "schedule a due-dated task"
// — its all-day due-date event wouldn't move to the timed slot.)

import { describe, it, expect } from "vitest";
import { taskToGCalEvent } from "../src/worker/lib/gcal";
import type { Task } from "../src/shared/types";

const base = {
  id: "t1",
  title: "Ship it",
  priority: 2,
} as unknown as Task;

describe("taskToGCalEvent", () => {
  it("timed block nulls the all-day date so a re-time PATCH clears it", () => {
    const ev = taskToGCalEvent({
      ...base,
      scheduled_start: "2026-07-14T10:00:00",
      scheduled_end: "2026-07-14T11:00:00",
      due_date: "2026-07-18",
    } as Task);
    expect(ev.start).toEqual({
      dateTime: "2026-07-14T10:00:00",
      timeZone: "Europe/Brussels",
      date: null,
    });
    expect(ev.end?.date).toBeNull();
  });

  it("all-day due date nulls the timed fields so a PATCH clears them", () => {
    const ev = taskToGCalEvent({
      ...base,
      scheduled_start: null,
      scheduled_end: null,
      due_date: "2026-07-18",
    } as Task);
    expect(ev.start).toEqual({
      date: "2026-07-18",
      dateTime: null,
      timeZone: null,
    });
  });

  it("respects the sync prefs (time-blocks off -> falls through to due date)", () => {
    const ev = taskToGCalEvent(
      {
        ...base,
        scheduled_start: "2026-07-14T10:00:00",
        scheduled_end: "2026-07-14T11:00:00",
        due_date: "2026-07-18",
      } as Task,
      { timeBlocks: false, dueDates: true }
    );
    expect(ev.start?.date).toBe("2026-07-18");
    expect(ev.start?.dateTime).toBeNull();
  });
});
