// One bad row must degrade one chip, not the page around it.
//
// dueLabel was the call that blanked the app: date-fns v4 coerces with +, so a
// column holding the string "null" became NaN, then Invalid Date, and format
// threw a RangeError mid-render. A throw in render unmounts the React tree.

import { describe, it, expect } from "vitest";
import { dueLabel } from "../lib/due";
import { safeFormat, safeParse, isRealDate } from "../lib/safe-date";

const TODAY = "2026-08-25";

describe("dueLabel survives a corrupt date", () => {
  it("does not throw on the exact value that blanked the app", () => {
    expect(() => dueLabel("null", TODAY)).not.toThrow();
  });

  it("prints the raw value rather than a lie or a crash", () => {
    expect(dueLabel("null", TODAY)).toBe("null");
    expect(dueLabel("not-a-date", TODAY)).toBe("not-a-date");
  });

  it("still reads real dates the way it always did", () => {
    expect(dueLabel(TODAY, TODAY)).toBe("Today");
    expect(dueLabel("2026-08-26", TODAY)).toBe("Tomorrow");
    expect(dueLabel("2026-08-24", TODAY)).toBe("Yesterday");
    expect(dueLabel("2026-12-01", TODAY)).toBe("1 Dec");
  });
});

describe("safeFormat / safeParse", () => {
  it("returns null instead of throwing, whatever it is handed", () => {
    for (const v of ["null", "", "abc", null, undefined])
      expect(safeFormat(v, "d MMM")).toBeNull();
    expect(safeParse("null")).toBeNull();
  });

  it("formats a real date normally", () => {
    expect(safeFormat("2026-08-25", "d MMM yyyy")).toBe("25 Aug 2026");
  });

  it("isRealDate gates on the stored shape, not on truthiness", () => {
    expect(isRealDate("2026-08-25")).toBe(true);
    expect(isRealDate("null")).toBe(false);
    expect(isRealDate("2026-08-25T10:00:00Z")).toBe(false);
    expect(isRealDate(null)).toBe(false);
  });
});
