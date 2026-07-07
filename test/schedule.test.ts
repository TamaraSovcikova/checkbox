import { describe, it, expect } from "vitest";
import { scheduleBlocks, type SchedTask } from "../src/shared/schedule";

const MIN = 60000;
const H = 60 * MIN;
// Fixed epoch base aligned to the 15-minute grid (900000 * 1977778) so the
// round-up assertions are exact. The scheduler is tz-agnostic — only sees ms.
const BASE = 1_780_000_200_000;

function t(id: string, priority: number, estimateMin: number): SchedTask {
  return { id, title: id, priority, estimateMin, dueTime: null };
}

describe("scheduleBlocks", () => {
  it("places tasks back-to-back from the window start", () => {
    const res = scheduleBlocks(
      [t("a", 4, 60), t("b", 4, 30)],
      [],
      BASE,
      BASE + 9 * H
    );
    expect(res.blocks).toHaveLength(2);
    expect(res.blocks[0].startMs).toBe(BASE);
    expect(res.blocks[0].endMs).toBe(BASE + 1 * H);
    expect(res.blocks[1].startMs).toBe(res.blocks[0].endMs);
  });

  it("rounds the window start up to the 15-minute grid", () => {
    const res = scheduleBlocks([t("a", 4, 30)], [], BASE + 5 * MIN, BASE + 9 * H);
    // 5 past the hour rounds up to :15
    expect(res.blocks[0].startMs).toBe(BASE + 15 * MIN);
  });

  it("routes a task around a busy interval it can't fit before", () => {
    const busy = [{ startMs: BASE + 30 * MIN, endMs: BASE + 90 * MIN }];
    const res = scheduleBlocks([t("a", 4, 60)], busy, BASE, BASE + 9 * H);
    expect(res.blocks[0].startMs).toBe(BASE + 90 * MIN);
  });

  it("orders higher priority first", () => {
    const res = scheduleBlocks(
      [t("low", 4, 60), t("high", 1, 60)],
      [],
      BASE,
      BASE + 9 * H
    );
    expect(res.blocks[0].task_id).toBe("high");
  });

  it("reports tasks that overflow the window as unscheduled", () => {
    const res = scheduleBlocks(
      [t("a", 4, 300), t("b", 4, 300)],
      [],
      BASE,
      BASE + 9 * H
    );
    expect(res.blocks).toHaveLength(1);
    expect(res.unscheduled).toHaveLength(1);
    expect(res.unscheduled[0].id).toBe("b");
  });
});
