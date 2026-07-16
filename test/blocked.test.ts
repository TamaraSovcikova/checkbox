import { describe, it, expect } from "vitest";
import {
  isBlocked,
  openBlockerCount,
  dateBlocked,
  blockedLabel,
} from "../src/client/lib/blocked";
import type { Task } from "../src/shared/types";

const TODAY = "2026-07-15";

const task = (over: Partial<Task> = {}): Task =>
  ({
    id: "t1",
    title: "T",
    status: "todo",
    blocked_until: null,
    depends_on: [],
    ...over,
  }) as Task;

describe("blocked helpers", () => {
  it("blocked by an open dependency", () => {
    const t = task({ depends_on: [{ id: "a", title: "A", status: "todo" }] });
    expect(openBlockerCount(t)).toBe(1);
    expect(isBlocked(t, TODAY)).toBe(true);
    expect(blockedLabel(t, TODAY)).toBe("1 blocker");
  });

  it("a done dependency does not block", () => {
    const t = task({ depends_on: [{ id: "a", title: "A", status: "done" }] });
    expect(isBlocked(t, TODAY)).toBe(false);
    expect(blockedLabel(t, TODAY)).toBeNull();
  });

  it("blocked until a future date", () => {
    const t = task({ blocked_until: "2026-07-18" });
    expect(dateBlocked(t, TODAY)).toBe(true);
    expect(isBlocked(t, TODAY)).toBe(true);
    expect(blockedLabel(t, TODAY)).toBe("until 2026-07-18");
  });

  it("a past blocked_until no longer blocks", () => {
    const t = task({ blocked_until: "2026-07-10" });
    expect(dateBlocked(t, TODAY)).toBe(false);
    expect(isBlocked(t, TODAY)).toBe(false);
  });

  it("combines date + task blockers in the label", () => {
    const t = task({
      blocked_until: "2026-07-18",
      depends_on: [{ id: "a", title: "A", status: "todo" }],
    });
    expect(blockedLabel(t, TODAY)).toBe("until 2026-07-18 +1");
  });

  it("a done task is never blocked", () => {
    const t = task({ status: "done", blocked_until: "2026-07-18" });
    expect(isBlocked(t, TODAY)).toBe(false);
    expect(blockedLabel(t, TODAY)).toBeNull();
  });
});
