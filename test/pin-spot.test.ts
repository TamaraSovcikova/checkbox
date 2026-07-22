// The unified "Show on" encoding for pins: one select value carrying scope +
// placement, plus the loose (nowhere) case. The round-trip is what the card
// relies on, so it is pinned here.

import { describe, it, expect } from "vitest";
import {
  encodeSpot,
  decodeSpot,
  spotValueOf,
  isLoose,
  spotOptions,
} from "../src/client/lib/pinScope";
import type { Area, Pin } from "../src/shared/types";

const pin = (over: Partial<Pin> = {}): Pin =>
  ({
    id: "p1",
    kind: "list",
    title: null,
    body: null,
    items: [],
    pinned_today: 0,
    placement: "unpinned",
    scope: "today",
    color: null,
    span: 2,
    height: null,
    created_at: "",
    updated_at: "",
    ...over,
  }) as Pin;

describe("encode/decode spot", () => {
  it("round-trips a placed pin", () => {
    expect(decodeSpot(encodeSpot("area:x", "side"))).toEqual({
      scope: "area:x",
      placement: "side",
    });
    expect(decodeSpot(encodeSpot("today", "top"))).toEqual({
      scope: "today",
      placement: "top",
    });
  });

  it("maps a loose pin to 'nowhere' and back to unpinned", () => {
    expect(encodeSpot("today", "unpinned")).toBe("nowhere");
    expect(decodeSpot("nowhere")).toEqual({ scope: "today", placement: "unpinned" });
  });

  it("survives a scope containing no @ oddity", () => {
    // area ids are uuids, never contain '@', so the first '@' is the separator.
    const v = encodeSpot("area:abc-123", "top");
    expect(decodeSpot(v)).toEqual({ scope: "area:abc-123", placement: "top" });
  });
});

describe("spotValueOf / isLoose", () => {
  it("a loose pin reads as nowhere", () => {
    const p = pin({ placement: "unpinned", scope: "area:x" });
    expect(isLoose(p)).toBe(true);
    expect(spotValueOf(p)).toBe("nowhere");
  });

  it("a placed pin reads as placement@scope", () => {
    const p = pin({ placement: "side", scope: "area:x" });
    expect(isLoose(p)).toBe(false);
    expect(spotValueOf(p)).toBe("side@area:x");
  });

  it("defaults a missing scope to today", () => {
    const p = pin({ placement: "top", scope: "" });
    expect(spotValueOf(p)).toBe("top@today");
  });
});

describe("spotOptions", () => {
  const areas = [
    { id: "a1", name: "Health" },
    { id: "a2", name: "Work" },
  ] as Area[];

  it("leads with Nowhere, then Today, then each area, each with top+side", () => {
    const opts = spotOptions(areas);
    expect(opts[0].options[0]).toEqual({ value: "nowhere", label: "Nowhere (just a list)" });
    expect(opts[1].group).toBe("Today");
    expect(opts.map((g) => g.group)).toEqual(["", "Today", "Health", "Work"]);
    // Every page group offers exactly top + side.
    for (const g of opts.slice(1)) {
      expect(g.options.map((o) => o.value)).toHaveLength(2);
    }
  });

  it("every produced value decodes back to a valid spot", () => {
    for (const g of spotOptions(areas)) {
      for (const o of g.options) {
        const d = decodeSpot(o.value);
        expect(["top", "side", "unpinned"]).toContain(d.placement);
      }
    }
  });
});
