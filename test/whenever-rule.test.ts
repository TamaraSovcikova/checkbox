// "Whenever" and a date are contradictory claims, so no writer holds both.
//
// Enforced in shared code rather than in the sheet, because the sheet is not the
// only writer: the MCP connector could otherwise produce a state the UI forbids,
// and an invariant only one client honours is not an invariant. Flagging a dated
// task DROPS its deadline, which is what the flag means and exactly the sort of
// loss that must be reported rather than done quietly.

import { describe, it, expect } from "vitest";
import {
  applyWheneverRule,
  applyDateClearsWhenever,
  flagOn,
  normalizeFlags,
} from "../src/shared/dates";

describe("applyWheneverRule", () => {
  it("clears every date when the flag goes on", () => {
    const r = applyWheneverRule({
      whenever: 1,
      due_date: "2026-09-01",
      due_time: "14:00",
      planned_date: "2026-08-27",
    });
    expect(r.body).toMatchObject({
      whenever: 1,
      due_date: null,
      due_time: null,
      planned_date: null,
    });
  });

  it("names what it actually took away, not what it merely nulled", () => {
    const r = applyWheneverRule({ whenever: 1 }, { due_date: "2026-09-01" });
    expect(r.cleared).toEqual(["due_date"]);
  });

  it("reports nothing when the task had no dates to lose", () => {
    expect(applyWheneverRule({ whenever: 1 }, {}).cleared).toEqual([]);
  });

  it("sees dates arriving in the SAME write, not just the stored ones", () => {
    const r = applyWheneverRule({ whenever: 1, due_date: "2026-09-01" }, {});
    expect(r.cleared).toEqual(["due_date"]);
    expect(r.body.due_date).toBeNull();
  });

  it("does nothing at all when the flag is not being turned on", () => {
    const body = { whenever: 0, due_date: "2026-09-01" };
    expect(applyWheneverRule(body, {})).toEqual({ body, cleared: [] });
    const noFlag = { title: "x", due_date: "2026-09-01" };
    expect(applyWheneverRule(noFlag, {})).toEqual({ body: noFlag, cleared: [] });
  });

  it("turning the flag OFF restores nothing: re-dating it is her decision", () => {
    const r = applyWheneverRule({ whenever: 0 }, { due_date: "2026-09-01" });
    expect(r.body).toEqual({ whenever: 0 });
    expect(r.cleared).toEqual([]);
  });

  it("accepts the boolean form as well as the 0/1 D1 form", () => {
    expect(applyWheneverRule({ whenever: true }, { due_date: "x" }).cleared).toEqual([
      "due_date",
    ]);
  });
});

// The bug this section exists for, found live rather than in a test: setting the
// flag through the MCP connector set `whenever` but did NOT clear the dates, and
// reported nothing. The value arrived as the STRING "1", because the client's
// cached tool schema predated the field, and `args.whenever === 1` was false.
//
// Same shape as the "null" date incident: a writer trusting that the wire
// matches the schema it published. D1 has no boolean, the columns are 0/1, and
// the value can legitimately show up as a number, a boolean or a string.
describe("flagOn / normalizeFlags", () => {
  it("accepts every spelling a caller might send", () => {
    for (const v of [1, true, "1", "true", "TRUE"]) expect(flagOn(v)).toBe(true);
  });

  it("treats everything else as off, including the strings that look truthy", () => {
    for (const v of [0, false, "0", "false", "", null, undefined, "yes", 2])
      expect(flagOn(v)).toBe(false);
  });

  it("stores 0 or 1, never a third spelling of the same thing", () => {
    expect(normalizeFlags({ whenever: "1", optional: true })).toEqual({
      whenever: 1,
      optional: 1,
    });
    expect(normalizeFlags({ whenever: "false" })).toEqual({ whenever: 0 });
  });

  it("leaves fields it was not given alone", () => {
    expect(normalizeFlags({ title: "x" })).toEqual({ title: "x" });
  });

  it("clears the dates when the flag arrives as a string, which is the live bug", () => {
    const r = applyWheneverRule({ whenever: "1" }, { planned_date: "2026-09-15" });
    expect(r.cleared).toEqual(["planned_date"]);
    expect(r.body).toMatchObject({ whenever: 1, planned_date: null });
  });
});

// The inverse. applyWheneverRule closes one direction; without this one the
// other stayed open, and not hypothetically: the Today toggle on every row
// writes planned_date, so adding a flagged task to Today produced exactly the
// contradiction the flag exists to prevent, from a control that looks innocent.
describe("applyDateClearsWhenever", () => {
  const flagged = { whenever: 1 };

  it("clears the flag when a date is set on a flagged task", () => {
    const r = applyDateClearsWhenever({ planned_date: "2026-09-01" }, flagged);
    expect(r.unflagged).toBe(true);
    expect(r.body).toEqual({ planned_date: "2026-09-01", whenever: 0 });
  });

  it("counts a due date and a calendar block, not just a plan", () => {
    expect(
      applyDateClearsWhenever({ due_date: "2026-09-01" }, flagged).unflagged
    ).toBe(true);
    expect(
      applyDateClearsWhenever({ scheduled_start: "2026-09-01T09:00:00Z" }, flagged)
        .unflagged
    ).toBe(true);
  });

  it("does NOT fire on clearing a date: that says nothing about deadlines", () => {
    // Otherwise removing a due date would quietly flag half the backlog.
    const r = applyDateClearsWhenever({ due_date: null }, flagged);
    expect(r.unflagged).toBe(false);
    expect(r.body).toEqual({ due_date: null });
  });

  it("leaves an unflagged task completely alone", () => {
    const body = { planned_date: "2026-09-01" };
    expect(applyDateClearsWhenever(body, { whenever: 0 })).toEqual({
      body,
      unflagged: false,
    });
  });

  it("defers to an explicit flag in the same write", () => {
    // "Make it whenever AND give it a date" is contradictory, and
    // applyWheneverRule has already resolved it by clearing the date. This must
    // not then undo the flag and leave neither rule applied.
    const r = applyDateClearsWhenever(
      { whenever: 1, planned_date: null },
      flagged
    );
    expect(r.unflagged).toBe(false);
  });

  it("the two rules together leave a coherent task, whichever order they arrive", () => {
    // Flagging a dated task: flag on, dates gone.
    const a = applyWheneverRule({ whenever: 1 }, { due_date: "2026-09-01" });
    const a2 = applyDateClearsWhenever(a.body, { whenever: 0 });
    expect(a2.body).toMatchObject({ whenever: 1, due_date: null });

    // Dating a flagged task: date kept, flag gone.
    const b = applyWheneverRule({ due_date: "2026-09-01" }, flagged);
    const b2 = applyDateClearsWhenever(b.body, flagged);
    expect(b2.body).toEqual({ due_date: "2026-09-01", whenever: 0 });
  });
});
