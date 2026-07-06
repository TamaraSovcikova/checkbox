import { describe, it, expect } from "vitest";
import { nextDueDate, recurrenceLabel } from "../src/shared/recurrence";

const dow = (d: string) => new Date(d + "T00:00:00Z").getUTCDay();

describe("nextDueDate", () => {
  it("advances simple intervals", () => {
    expect(nextDueDate("daily", "2026-07-06")).toBe("2026-07-07");
    expect(nextDueDate("weekly", "2026-07-06")).toBe("2026-07-13");
    expect(nextDueDate("yearly", "2026-07-06")).toBe("2027-07-06");
  });

  it("clamps month-end overflow", () => {
    expect(nextDueDate("monthly", "2026-01-31")).toBe("2026-02-28");
    expect(nextDueDate("monthly", "2026-01-15")).toBe("2026-02-15");
  });

  it("handles every:N:unit", () => {
    expect(nextDueDate("every:3:day", "2026-07-06")).toBe("2026-07-09");
    expect(nextDueDate("every:2:week", "2026-07-06")).toBe("2026-07-20");
    expect(nextDueDate("every:2:month", "2026-01-31")).toBe("2026-03-31");
  });

  it("weekdays lands on Mon-Fri and skips weekends", () => {
    const next = nextDueDate("weekdays", "2026-07-10")!;
    expect(dow(next)).toBeGreaterThanOrEqual(1);
    expect(dow(next)).toBeLessThanOrEqual(5);
  });

  it("weekly:<day> lands on the requested weekday, strictly after", () => {
    const mon = nextDueDate("weekly:mon", "2026-07-06")!;
    expect(dow(mon)).toBe(1);
    expect(mon > "2026-07-06").toBe(true);
  });

  it("returns null for empty or unknown specs", () => {
    expect(nextDueDate("", "2026-07-06")).toBeNull();
    expect(nextDueDate(null, "2026-07-06")).toBeNull();
    expect(nextDueDate("nonsense", "2026-07-06")).toBeNull();
  });
});

describe("recurrenceLabel", () => {
  it("renders friendly labels", () => {
    expect(recurrenceLabel("daily")).toBe("Daily");
    expect(recurrenceLabel("weekdays")).toBe("Every weekday");
    expect(recurrenceLabel("every:2:week")).toBe("Every 2 weeks");
    expect(recurrenceLabel("weekly:mon,fri")).toBe("Weekly · Mon, Fri");
    expect(recurrenceLabel(null)).toBeNull();
  });
});
