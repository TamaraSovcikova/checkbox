// How a cadence tracker reads. The sort order is the load-bearing part: this
// page exists to put the thing you have neglected longest at the top.

import { describe, it, expect } from "vitest";
import {
  daysBetween,
  daysSince,
  cadenceStatus,
  cadenceFill,
  urgency,
  sortByUrgency,
  sinceLabel,
} from "../src/client/lib/cadence";
import type { Tracker } from "../src/shared/types";

const TODAY = "2026-07-17";

const tracker = (over: Partial<Tracker> = {}): Tracker => ({
  id: "t1",
  name: "Ivka",
  kind: "contact",
  target_days: 14,
  area_id: null,
  notes: null,
  archived: false,
  position: 0,
  created_at: "2026-01-01",
  last_at: null,
  event_count: 0,
  ...over,
});

describe("daysBetween", () => {
  it("counts whole calendar days", () => {
    expect(daysBetween("2026-07-10", TODAY)).toBe(7);
    expect(daysBetween(TODAY, TODAY)).toBe(0);
  });

  // The DST trap from lib/due.ts: a local-time day can be 23 or 25 hours long,
  // so elapsed-ms division rounds wrong. UTC construction avoids it.
  it("survives both Brussels DST boundaries", () => {
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2); // spring forward
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2); // fall back
  });

  it("spans a year boundary", () => {
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
  });
});

describe("daysSince", () => {
  it("is null when it has never happened", () => {
    expect(daysSince(tracker(), TODAY)).toBeNull();
  });

  it("reads the date part, ignoring the time of day", () => {
    // Called late last night; at any hour today that is still 1 day ago.
    expect(daysSince(tracker({ last_at: "2026-07-16T23:30:00.000Z" }), TODAY)).toBe(1);
    expect(daysSince(tracker({ last_at: "2026-07-17T00:05:00.000Z" }), TODAY)).toBe(0);
  });
});

describe("cadenceStatus", () => {
  it("is fresh well inside the target", () => {
    expect(cadenceStatus(tracker({ last_at: "2026-07-15", target_days: 14 }), TODAY)).toBe("fresh");
  });

  it("warns as it approaches (>= 75%)", () => {
    // 11/14 = 0.79
    expect(cadenceStatus(tracker({ last_at: "2026-07-06", target_days: 14 }), TODAY)).toBe("soon");
  });

  it("is due at exactly the target, not a day later", () => {
    expect(cadenceStatus(tracker({ last_at: "2026-07-03", target_days: 14 }), TODAY)).toBe("due");
  });

  it("stays due once well past", () => {
    expect(cadenceStatus(tracker({ last_at: "2026-05-01", target_days: 14 }), TODAY)).toBe("due");
  });

  it("is never when it has a target but no history", () => {
    expect(cadenceStatus(tracker({ last_at: null }), TODAY)).toBe("never");
  });

  // The point of a null target: count it, do not nag about it.
  it("an untargeted tracker is never due, however old", () => {
    expect(
      cadenceStatus(tracker({ target_days: null, last_at: "2020-01-01" }), TODAY)
    ).toBe("fresh");
    expect(cadenceStatus(tracker({ target_days: null, last_at: null }), TODAY)).toBe("fresh");
  });
});

describe("cadenceFill", () => {
  it("is proportional inside the target", () => {
    expect(cadenceFill(tracker({ last_at: "2026-07-10", target_days: 14 }), TODAY)).toBeCloseTo(0.5);
  });

  it("clamps at full rather than overflowing the track", () => {
    expect(cadenceFill(tracker({ last_at: "2026-01-01", target_days: 14 }), TODAY)).toBe(1);
  });

  it("is empty with no target or no history", () => {
    expect(cadenceFill(tracker({ target_days: null, last_at: "2026-01-01" }), TODAY)).toBe(0);
    expect(cadenceFill(tracker({ last_at: null }), TODAY)).toBe(0);
  });
});

describe("sortByUrgency", () => {
  it("puts the most overdue first, by ratio not raw days", () => {
    // 20/14 = 1.43 vs 8/3 = 2.67: the weekly one is further past its cadence
    // even though fewer days have passed.
    const fortnightly = tracker({ id: "a", last_at: "2026-06-27", target_days: 14 });
    const everyThree = tracker({ id: "b", last_at: "2026-07-09", target_days: 3 });
    expect(sortByUrgency([fortnightly, everyThree], TODAY).map((t) => t.id)).toEqual([
      "b",
      "a",
    ]);
  });

  it("floats a targeted tracker that has never been logged to the very top", () => {
    const never = tracker({ id: "never", last_at: null, target_days: 30 });
    const due = tracker({ id: "due", last_at: "2026-01-01", target_days: 14 });
    expect(sortByUrgency([due, never], TODAY)[0].id).toBe("never");
  });

  // An untargeted tracker opted out of urgency; it must not outrank real ones.
  it("sinks untargeted trackers below anything with a target", () => {
    const ancientNoTarget = tracker({ id: "loose", target_days: null, last_at: "2019-01-01" });
    const mildlyFresh = tracker({ id: "kept", target_days: 30, last_at: "2026-07-16" });
    expect(sortByUrgency([ancientNoTarget, mildlyFresh], TODAY).map((t) => t.id)).toEqual([
      "kept",
      "loose",
    ]);
  });

  it("does not mutate the array it was given", () => {
    const list = [tracker({ id: "a" }), tracker({ id: "b", last_at: "2026-01-01" })];
    const before = list.map((t) => t.id);
    sortByUrgency(list, TODAY);
    expect(list.map((t) => t.id)).toEqual(before);
  });
});

describe("sinceLabel", () => {
  it("names the recent cases and counts the rest", () => {
    expect(sinceLabel(tracker({ last_at: null }), TODAY)).toBe("never");
    expect(sinceLabel(tracker({ last_at: TODAY }), TODAY)).toBe("today");
    expect(sinceLabel(tracker({ last_at: "2026-07-16" }), TODAY)).toBe("yesterday");
    expect(sinceLabel(tracker({ last_at: "2026-07-12" }), TODAY)).toBe("5 days ago");
  });
});

describe("urgency", () => {
  it("scores an untargeted tracker at zero", () => {
    expect(urgency(tracker({ target_days: null, last_at: "2020-01-01" }), TODAY)).toBe(0);
  });
});
