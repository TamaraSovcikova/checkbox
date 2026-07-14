import { describe, it, expect } from "vitest";
import { packLanes } from "../lib/lanes";

// Minutes since midnight -> ms epoch on an arbitrary fixed day (only relative
// order matters to packLanes).
const t = (min: number) => min * 60_000;
const item = (key: string, startMin: number, endMin: number) => ({
  key,
  startMs: t(startMin),
  endMs: t(endMin),
});

describe("packLanes", () => {
  it("gives non-overlapping items a single full-width lane", () => {
    const lanes = packLanes([item("a", 0, 60), item("b", 60, 120)]);
    expect(lanes.get("a")).toEqual({ index: 0, count: 1 });
    expect(lanes.get("b")).toEqual({ index: 0, count: 1 });
  });

  it("splits two overlapping items into two columns", () => {
    const lanes = packLanes([item("a", 0, 120), item("b", 60, 180)]);
    expect(lanes.get("a")).toEqual({ index: 0, count: 2 });
    expect(lanes.get("b")).toEqual({ index: 1, count: 2 });
  });

  it("a long block overlapping two shorter ones shares the cluster width", () => {
    // "Internship" 9-18 overlaps two tasks; all three are one cluster of width 2.
    const lanes = packLanes([
      item("intern", 540, 1080),
      item("task1", 600, 660),
      item("task2", 720, 780),
    ]);
    expect(lanes.get("intern")!.count).toBe(2);
    expect(lanes.get("task1")!.count).toBe(2);
    expect(lanes.get("task2")!.count).toBe(2);
    // The two short tasks don't overlap each other, so they reuse column 1.
    expect(lanes.get("task1")!.index).toBe(1);
    expect(lanes.get("task2")!.index).toBe(1);
  });

  it("separate clusters are packed independently", () => {
    const lanes = packLanes([
      item("a", 0, 120),
      item("b", 60, 180),
      item("c", 300, 360), // disjoint from a/b
    ]);
    expect(lanes.get("c")).toEqual({ index: 0, count: 1 });
  });
});
