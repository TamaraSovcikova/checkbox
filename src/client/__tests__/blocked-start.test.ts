// The one-click offer in a blocked task's planned-date picker.
//
// Her first instinct was to have the app SET this date automatically from the
// blocker's due date, and she then doubted it. The doubt was right: a blocker
// due the 1st might be finished on the 25th or the 8th, so a derived date is a
// forecast wearing the clothes of a decision, and when the blocker slips nothing
// says the derived date went stale.
//
// So the number is computed and OFFERED, never written. The automatic half lives
// elsewhere and fires on the completion itself (worker/lib/unblock).

import { describe, it, expect } from "vitest";
import {
  earliestStartAfterBlockers,
  openBlockers,
} from "../lib/blocked";
import type { Task, TaskRef } from "../../shared/types";

const task = (deps: TaskRef[]): Task =>
  ({ id: "t1", status: "todo", depends_on: deps }) as Task;

const ref = (
  id: string,
  due: string | null,
  status: "todo" | "done" = "todo"
): TaskRef => ({ id, title: id, status, due_date: due });

describe("earliestStartAfterBlockers", () => {
  it("is the day after the blocker is due", () => {
    expect(earliestStartAfterBlockers(task([ref("b", "2026-09-01")]))).toBe(
      "2026-09-02"
    );
  });

  it("takes the LAST blocker, since all of them have to land first", () => {
    expect(
      earliestStartAfterBlockers(
        task([ref("b1", "2026-09-01"), ref("b2", "2026-09-10")])
      )
    ).toBe("2026-09-11");
  });

  it("ignores blockers that are already done", () => {
    expect(
      earliestStartAfterBlockers(
        task([ref("b1", "2026-12-31", "done"), ref("b2", "2026-09-01")])
      )
    ).toBe("2026-09-02");
  });

  it("crosses a month and a year end correctly", () => {
    expect(earliestStartAfterBlockers(task([ref("b", "2026-09-30")]))).toBe(
      "2026-10-01"
    );
    expect(earliestStartAfterBlockers(task([ref("b", "2026-12-31")]))).toBe(
      "2027-01-01"
    );
    // 2028 is a leap year: the day after 28 Feb is the 29th, not 1 Mar.
    expect(earliestStartAfterBlockers(task([ref("b", "2028-02-28")]))).toBe(
      "2028-02-29"
    );
  });

  it("offers nothing when there is nothing to compute from", () => {
    expect(earliestStartAfterBlockers(task([]))).toBeNull();
    // A blocker with no deadline of its own tells you nothing about timing.
    expect(earliestStartAfterBlockers(task([ref("b", null)]))).toBeNull();
    expect(
      earliestStartAfterBlockers(task([ref("b", "2026-09-01", "done")]))
    ).toBeNull();
  });

  it("openBlockers counts only what is still in the way", () => {
    const t = task([ref("b1", null), ref("b2", null, "done")]);
    expect(openBlockers(t).map((d) => d.id)).toEqual(["b1"]);
  });
});
