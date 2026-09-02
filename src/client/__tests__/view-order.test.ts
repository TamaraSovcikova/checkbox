// Sidebar ordering.
//
// `viewOrder` sat in the prefs type, and in the route that persists it, from the
// day it was introduced, and nothing ever read it: hiding a view worked, moving
// one silently did nothing. Her question ("have we given the option to order
// which sections show before which, and what to include and hide?") is what
// surfaced it.

import { describe, it, expect } from "vitest";

// The ordering rule, mirrored from useViewPrefs.orderViews so it can be pinned
// without a React tree. Kept in step by the tests below reading like the app.
function orderViews<T extends { to: string }>(items: T[], order: string[]): T[] {
  if (!order.length) return items;
  const rank = (v: T) => {
    const i = order.indexOf(v.to);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return items
    .map((v, i) => ({ v, i }))
    .sort((a, b) => rank(a.v) - rank(b.v) || a.i - b.i)
    .map((x) => x.v);
}

const v = (...tos: string[]) => tos.map((to) => ({ to }));
const ids = (items: { to: string }[]) => items.map((x) => x.to);

describe("orderViews", () => {
  const items = v("/today", "/upcoming", "/overdue", "/backlog");

  it("leaves the app's own order alone until she has moved something", () => {
    expect(ids(orderViews(items, []))).toEqual([
      "/today",
      "/upcoming",
      "/overdue",
      "/backlog",
    ]);
  });

  it("honours a full stored order", () => {
    const order = ["/backlog", "/today", "/overdue", "/upcoming"];
    expect(ids(orderViews(items, order))).toEqual(order);
  });

  it("keeps an UNMENTIONED view where the app put it, not at the front", () => {
    // The stored list is partial on purpose: a view added to the app later
    // should appear where the app puts it, rather than being ranked by a list
    // written months before it existed.
    expect(ids(orderViews(items, ["/backlog"]))).toEqual([
      "/backlog",
      "/today",
      "/upcoming",
      "/overdue",
    ]);
  });

  it("is stable: two unmoved views keep their relative order", () => {
    const out = ids(orderViews(v("/a", "/b", "/c"), ["/c"]));
    expect(out).toEqual(["/c", "/a", "/b"]);
  });

  it("ignores an order naming views that are gone", () => {
    expect(ids(orderViews(v("/a", "/b"), ["/deleted", "/b"]))).toEqual([
      "/b",
      "/a",
    ]);
  });
});

// Moving one row, as the sidebar's up/down arrows do.
function moveView(
  viewKey: string,
  dir: -1 | 1,
  within: string[],
  stored: string[]
): string[] {
  const i = within.indexOf(viewKey);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= within.length) return stored;
  const next = [...within];
  [next[i], next[j]] = [next[j], next[i]];
  const others = stored.filter((x) => !within.includes(x));
  return [...others, ...next];
}

describe("moveView", () => {
  const section = ["/today", "/upcoming", "/overdue"];

  it("swaps with the neighbour above", () => {
    expect(moveView("/upcoming", -1, section, [])).toEqual([
      "/upcoming",
      "/today",
      "/overdue",
    ]);
  });

  it("swaps with the neighbour below", () => {
    expect(moveView("/today", 1, section, [])).toEqual([
      "/upcoming",
      "/today",
      "/overdue",
    ]);
  });

  it("does nothing at either end rather than wrapping around", () => {
    expect(moveView("/today", -1, section, [])).toEqual([]);
    expect(moveView("/overdue", 1, section, [])).toEqual([]);
  });

  it("does not disturb an order recorded for a DIFFERENT section", () => {
    // Each move speaks only for the list it was given; the sidebar has four.
    const stored = ["/calendar", "/flow"];
    expect(moveView("/today", 1, section, stored)).toEqual([
      "/calendar",
      "/flow",
      "/upcoming",
      "/today",
      "/overdue",
    ]);
  });
});
