// Today-capacity maths: free time is now -> day end minus MERGED busy overlap,
// and the overcommit flag only fires when something is actually planned.

import { describe, it, expect } from "vitest";
import { computeCapacity, fmtMin } from "../src/shared/capacity";

const H = (h: number, m = 0) => h * 60 + m;

describe("computeCapacity", () => {
  it("sums estimates and counts the unestimated", () => {
    const c = computeCapacity([30, 45, null, undefined, 0], [], H(9));
    expect(c.plannedMin).toBe(75);
    expect(c.unestimated).toBe(3); // null, undefined and 0 all mean "no estimate"
  });

  it("free time is now to 22:00 with no events", () => {
    const c = computeCapacity([60], [], H(20));
    expect(c.freeMin).toBe(120);
    expect(c.over).toBe(false);
  });

  it("subtracts events, merging overlaps so they never double-count", () => {
    // 14:00-16:00 and 15:00-17:00 overlap: busy is 14:00-17:00 = 3h.
    const c = computeCapacity([60], [[H(14), H(16)], [H(15), H(17)]], H(12));
    expect(c.freeMin).toBe(H(22) - H(12) - 180);
  });

  it("clips events to the remaining window (past and post-22:00 parts ignored)", () => {
    // At 15:00, a 9:00-10:00 meeting is history; 21:00-23:00 only costs 21->22.
    const c = computeCapacity([60], [[H(9), H(10)], [H(21), H(23)]], H(15));
    expect(c.freeMin).toBe(H(22) - H(15) - 60);
  });

  it("flags overcommit only when planned exceeds free AND something is planned", () => {
    expect(computeCapacity([300], [], H(20)).over).toBe(true); // 5h into 2h
    expect(computeCapacity([], [], H(23)).over).toBe(false); // nothing planned
    expect(computeCapacity([null], [], H(23)).over).toBe(false);
  });

  it("late evening: free clamps to zero, never negative", () => {
    const c = computeCapacity([30], [], H(23, 30));
    expect(c.freeMin).toBe(0);
    expect(c.over).toBe(true);
  });
});

describe("fmtMin", () => {
  it("formats hours and minutes tersely", () => {
    expect(fmtMin(0)).toBe("0m");
    expect(fmtMin(45)).toBe("45m");
    expect(fmtMin(60)).toBe("1h");
    expect(fmtMin(250)).toBe("4h 10m");
  });
});
