// Hiding a task's chip in the calendar's all-day box removes its event from
// Google Calendar. That is a real deletion on the user's calendar, so the rule
// deciding it is pinned here.
//
// The safety property that matters: this only ever governs events CHECKBOX made
// for a task. Entries from the rest of the calendar have no task row and so never
// reach this code; they are hidden client-side by title instead.

import { describe, it, expect } from "vitest";
import { wantsGcalEvent } from "../src/worker/lib/sync";

const BOTH_ON = { timeBlocks: true, dueDates: true };

const task = (over: Partial<Parameters<typeof wantsGcalEvent>[0]> = {}) => ({
  gcal_hidden: 0,
  scheduled_start: null,
  due_date: null,
  ...over,
});

describe("wantsGcalEvent", () => {
  it("wants an event for a due-dated task", () => {
    expect(wantsGcalEvent(task({ due_date: "2026-07-20" }), BOTH_ON)).toBe(true);
  });

  it("wants an event for a time-blocked task", () => {
    expect(
      wantsGcalEvent(task({ scheduled_start: "2026-07-20T09:00:00.000Z" }), BOTH_ON)
    ).toBe(true);
  });

  it("wants NO event once the task is hidden, so the event gets deleted", () => {
    expect(
      wantsGcalEvent(task({ due_date: "2026-07-20", gcal_hidden: 1 }), BOTH_ON)
    ).toBe(false);
  });

  it("hiding beats a time-block too, not just a due date", () => {
    expect(
      wantsGcalEvent(
        task({ scheduled_start: "2026-07-20T09:00:00.000Z", gcal_hidden: 1 }),
        BOTH_ON
      )
    ).toBe(false);
  });

  it("is reversible: clearing the flag wants the event back", () => {
    const hidden = task({ due_date: "2026-07-20", gcal_hidden: 1 });
    expect(wantsGcalEvent(hidden, BOTH_ON)).toBe(false);
    // Un-hiding touches only the flag: the due date was never modified, which is
    // what lets a fresh event be pushed.
    expect(wantsGcalEvent({ ...hidden, gcal_hidden: 0 }, BOTH_ON)).toBe(true);
  });

  it("still respects the sync prefs when not hidden", () => {
    expect(
      wantsGcalEvent(task({ due_date: "2026-07-20" }), {
        timeBlocks: true,
        dueDates: false,
      })
    ).toBe(false);
  });

  it("wants nothing for a task with no dates at all", () => {
    expect(wantsGcalEvent(task(), BOTH_ON)).toBe(false);
  });
});
