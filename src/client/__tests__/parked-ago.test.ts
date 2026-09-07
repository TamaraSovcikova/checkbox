// "Parked 4 months ago".
//
// The AGE is the point of showing a parked task at all: the question in a review
// is not what day you parked it, it is how long it has sat there unexamined. A
// raw date makes you do that subtraction yourself, every time, for every row.

import { describe, it, expect } from "vitest";
import { parkedAgo } from "../lib/due";

const TODAY = "2026-09-02";

describe("parkedAgo", () => {
  it("says today rather than a number for something just parked", () => {
    expect(parkedAgo("2026-09-02T11:00:00.000Z", TODAY)).toBe("today");
    expect(parkedAgo("2026-09-01T11:00:00.000Z", TODAY)).toBe("yesterday");
  });

  it("counts days for the first fortnight, where days are what you think in", () => {
    expect(parkedAgo("2026-08-28T00:00:00.000Z", TODAY)).toBe("5 days ago");
  });

  it("rounds to weeks, then months, as precision stops mattering", () => {
    // Nobody decides anything differently on "38 days" versus "5 weeks".
    expect(parkedAgo("2026-07-26T00:00:00.000Z", TODAY)).toBe("5 weeks ago");
    expect(parkedAgo("2026-05-02T00:00:00.000Z", TODAY)).toBe("4 months ago");
  });

  it("copes with a clock skew rather than printing a negative age", () => {
    expect(parkedAgo("2026-09-05T00:00:00.000Z", TODAY)).toBe("just now");
  });

  it("reads the day out of a full timestamp", () => {
    // parked_at is an ISO instant; the age is measured in whole days.
    expect(parkedAgo("2026-08-31T23:59:59.000Z", TODAY)).toBe("2 days ago");
  });
});
