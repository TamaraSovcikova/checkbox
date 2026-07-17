// How a due date reads in a list. Rows used to print the raw ISO date, so every
// scan meant decoding "2026-07-17" against today. The boundaries are the whole
// risk here: off-by-one at midnight, and the week edge.

import { describe, it, expect } from "vitest";
import { dueLabel, isOverdue } from "../src/client/lib/due";

const TODAY = "2026-07-17"; // a Friday

describe("dueLabel", () => {
  it("names today, tomorrow and yesterday", () => {
    expect(dueLabel("2026-07-17", TODAY)).toBe("Today");
    expect(dueLabel("2026-07-18", TODAY)).toBe("Tomorrow");
    expect(dueLabel("2026-07-16", TODAY)).toBe("Yesterday");
  });

  it("uses a weekday inside the coming week", () => {
    expect(dueLabel("2026-07-19", TODAY)).toBe("Sun");
    expect(dueLabel("2026-07-23", TODAY)).toBe("Thu"); // today + 6, the last day in
  });

  it("falls back to a date once past the week", () => {
    // today + 7: a weekday name here would be ambiguous with the one just gone.
    expect(dueLabel("2026-07-24", TODAY)).toBe("24 Jul");
    expect(dueLabel("2026-09-01", TODAY)).toBe("1 Sep");
  });

  it("gives the date, not a count, for anything older than yesterday", () => {
    expect(dueLabel("2026-07-14", TODAY)).toBe("14 Jul");
    expect(dueLabel("2026-06-30", TODAY)).toBe("30 Jun");
  });

  it("includes the year only when it differs", () => {
    expect(dueLabel("2026-12-31", TODAY)).toBe("31 Dec");
    expect(dueLabel("2027-01-04", TODAY)).toBe("4 Jan 2027");
    expect(dueLabel("2025-11-02", TODAY)).toBe("2 Nov 2025");
  });

  // Adding 86_400_000ms to a local Date lands on the same day across a DST jump.
  // The shift is UTC string maths precisely so these hold.
  it("survives a spring-forward boundary", () => {
    // Europe/Brussels springs forward on 2026-03-29.
    expect(dueLabel("2026-03-29", "2026-03-28")).toBe("Tomorrow");
    expect(dueLabel("2026-03-28", "2026-03-29")).toBe("Yesterday");
    expect(dueLabel("2026-03-30", "2026-03-30")).toBe("Today");
  });

  it("survives an autumn fall-back boundary", () => {
    // ...and back on 2026-10-25.
    expect(dueLabel("2026-10-25", "2026-10-24")).toBe("Tomorrow");
    expect(dueLabel("2026-10-24", "2026-10-25")).toBe("Yesterday");
  });

  it("handles a year boundary in both directions", () => {
    expect(dueLabel("2027-01-01", "2026-12-31")).toBe("Tomorrow");
    expect(dueLabel("2026-12-31", "2027-01-01")).toBe("Yesterday");
  });
});

describe("isOverdue", () => {
  it("is true only strictly before today", () => {
    expect(isOverdue("2026-07-16", TODAY)).toBe(true);
    expect(isOverdue("2026-07-17", TODAY)).toBe(false); // due today is not late yet
    expect(isOverdue("2026-07-18", TODAY)).toBe(false);
  });
});
