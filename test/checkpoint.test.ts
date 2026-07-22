// Checkpoint scheduling. The rules that matter: pulses stop at the due date, a
// late "on track" restarts the clock from today, and no interval means off.

import { describe, it, expect } from "vitest";
import {
  shiftDays,
  nextCheckpoint,
  startCheckpointBody,
  advanceCheckpointBody,
} from "../src/shared/checkpoint";

describe("shiftDays", () => {
  it("adds whole days via UTC", () => {
    expect(shiftDays("2026-07-22", 14)).toBe("2026-08-05");
    expect(shiftDays("2026-07-22", -1)).toBe("2026-07-21");
  });
  it("survives a Brussels DST boundary", () => {
    expect(shiftDays("2026-03-28", 2)).toBe("2026-03-30"); // spring forward
    expect(shiftDays("2026-10-24", 2)).toBe("2026-10-26"); // fall back
  });
});

describe("nextCheckpoint", () => {
  it("advances by the interval", () => {
    expect(nextCheckpoint("2026-07-22", 14, null)).toBe("2026-08-05");
  });
  it("stops once the next pulse reaches the due date", () => {
    // Due 2026-08-01; a 14-day pulse from 07-22 lands 08-05, past due -> stop.
    expect(nextCheckpoint("2026-07-22", 14, "2026-08-01")).toBeNull();
  });
  it("keeps going while the pulse stays before the due date", () => {
    // Due far out: the pulse is fine.
    expect(nextCheckpoint("2026-07-22", 14, "2026-12-01")).toBe("2026-08-05");
  });
  it("treats the due date itself as the boundary (>=)", () => {
    // A pulse landing exactly on the due date is not scheduled; the due date is.
    expect(nextCheckpoint("2026-07-22", 10, "2026-08-01")).toBeNull();
  });
  it("returns null for a non-positive interval", () => {
    expect(nextCheckpoint("2026-07-22", 0, null)).toBeNull();
    expect(nextCheckpoint("2026-07-22", -5, null)).toBeNull();
  });
});

describe("startCheckpointBody", () => {
  it("sets the interval and the first pulse from today", () => {
    expect(startCheckpointBody("2026-07-22", 14, "2026-12-01")).toEqual({
      checkpoint_days: 14,
      checkpoint_next: "2026-08-05",
    });
  });
  it("turns checkpoints OFF when the first pulse would pass the due date", () => {
    // No point starting a cadence that is already done.
    expect(startCheckpointBody("2026-07-22", 14, "2026-08-01")).toEqual({
      checkpoint_days: null,
      checkpoint_next: null,
    });
  });
  it("turns off on a non-positive interval", () => {
    expect(startCheckpointBody("2026-07-22", 0, null)).toEqual({
      checkpoint_days: null,
      checkpoint_next: null,
    });
  });
});

describe("advanceCheckpointBody", () => {
  it("advances one interval when acknowledged on time", () => {
    // next was today; +14 -> 08-05.
    expect(advanceCheckpointBody("2026-07-22", 14, "2026-07-22", null)).toEqual({
      checkpoint_next: "2026-08-05",
    });
  });

  // The late case: the pulse was days ago and you finally tick it. Advancing
  // from the old date would fire again immediately; anchor at today instead.
  it("restarts from today when acknowledged late", () => {
    // next was 07-10 (12 days ago); +14 from TODAY -> 08-05, not 07-24.
    expect(advanceCheckpointBody("2026-07-22", 14, "2026-07-10", null)).toEqual({
      checkpoint_next: "2026-08-05",
    });
  });

  it("keeps the cadence when acknowledged early", () => {
    // next is 08-01 (future); +14 from there -> 08-15.
    expect(advanceCheckpointBody("2026-07-22", 14, "2026-08-01", null)).toEqual({
      checkpoint_next: "2026-08-15",
    });
  });

  it("clears the pulse once it would pass the due date", () => {
    expect(advanceCheckpointBody("2026-07-22", 14, "2026-07-22", "2026-08-01")).toEqual({
      checkpoint_next: null,
    });
  });

  it("clears when there is no interval", () => {
    expect(advanceCheckpointBody("2026-07-22", null, "2026-07-22", null)).toEqual({
      checkpoint_next: null,
    });
  });
});
