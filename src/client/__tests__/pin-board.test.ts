// The Cards board (#4): which column a card sits in, the column order, and
// what a drop writes.
import { describe, it, expect } from "vitest";
import type { Area, Pin, Project } from "../../shared/types";
import { boardColumns, columnOf, dropPatch, missingPlaces, LOOSE } from "../lib/pinBoard";

const areas = [
  { id: "a1", name: "Home" },
  { id: "a2", name: "Work" },
] as Area[];

let n = 0;
const pin = (over: Partial<Pin>): Pin =>
  ({
    id: `p${++n}`,
    kind: "list",
    title: null,
    body: null,
    items: [],
    placement: "top",
    scope: "today",
    color: null,
    position: 0,
    created_at: `2026-09-0${n % 9}`,
    ...over,
  }) as Pin;

describe("columnOf", () => {
  it("puts unpinned cards in Loose whatever scope they carry", () => {
    expect(columnOf(pin({ placement: "unpinned", scope: "area:a1" }))).toBe(LOOSE);
    expect(columnOf(pin({ placement: "side", scope: "area:a1" }))).toBe("area:a1");
  });
});

describe("boardColumns", () => {
  it("always shows Loose and Today, then only places that hold cards", () => {
    const cols = boardColumns([pin({ scope: "area:a2" })], areas);
    expect(cols.map((c) => c.key)).toEqual([LOOSE, "today", "area:a2"]);
    expect(cols.map((c) => c.label)).toEqual(["Loose", "Today", "Work"]);
  });

  it("orders areas like the sidebar and keeps an opened empty place", () => {
    const cols = boardColumns([pin({ scope: "area:a2" })], areas, ["area:a1"]);
    expect(cols.map((c) => c.key)).toEqual([LOOSE, "today", "area:a1", "area:a2"]);
  });

  it("never drops a card whose area was deleted", () => {
    const cols = boardColumns([pin({ scope: "area:gone" })], areas);
    expect(cols.at(-1)).toMatchObject({ key: "area:gone", label: "Deleted area" });
  });

  it("sorts each column by position", () => {
    const a = pin({ position: 2, title: "a" });
    const b = pin({ position: -1, title: "b" });
    const today = boardColumns([a, b], areas).find((c) => c.key === "today")!;
    expect(today.pins.map((p) => p.title)).toEqual(["b", "a"]);
  });

  it("offers only places not already on the board", () => {
    const cols = boardColumns([pin({ scope: "area:a1" })], areas);
    const keys = missingPlaces(cols, areas).map((o) => o.key);
    expect(keys).toContain("area:a2");
    expect(keys).not.toContain("area:a1");
    expect(keys).not.toContain("today");
  });
});

describe("dropPatch", () => {
  const col = [pin({ position: 0 }), pin({ position: 4 })];

  it("lands between neighbours", () => {
    expect(dropPatch(pin({}), "today", col, 1).position).toBe(2);
  });
  it("lands before the first and after the last", () => {
    expect(dropPatch(pin({}), "today", col, 0).position).toBe(-1);
    expect(dropPatch(pin({}), "today", col, 9).position).toBe(5);
  });
  it("unpins when dropped into Loose", () => {
    expect(dropPatch(pin({ placement: "side" }), LOOSE, [], 0)).toEqual({
      placement: "unpinned",
      position: 0,
    });
  });
  it("puts a loose card in the top strip of the page it lands on", () => {
    expect(dropPatch(pin({ placement: "unpinned" }), "area:a1", [], 0)).toMatchObject({
      scope: "area:a1",
      placement: "top",
    });
  });
  it("keeps a placed card's spot when it moves page", () => {
    expect(dropPatch(pin({ placement: "side" }), "area:a1", [], 0).placement).toBe("side");
  });
});

describe("projects and the archive", () => {
  const projects = [
    { id: "p1", name: "Launch", status: "active" },
    { id: "p2", name: "Old thing", status: "done" },
  ] as Project[];

  it("gives a project with cards its own column, after the areas", () => {
    const cols = boardColumns([pin({ scope: "project:p1" }), pin({ scope: "area:a1" })], areas, [], projects);
    expect(cols.map((c) => c.label)).toEqual(["Loose", "Today", "Home", "Launch"]);
  });

  it("offers active projects only as new places", () => {
    const cols = boardColumns([], areas, [], projects);
    const labels = missingPlaces(cols, areas, projects).map((o) => o.label);
    expect(labels).toContain("Launch");
    expect(labels).not.toContain("Old thing");
  });

  it("keeps archived cards off every column", () => {
    const cols = boardColumns([pin({ archived_at: "2026-09-01T00:00:00Z" })], areas);
    expect(cols.flatMap((c) => c.pins)).toEqual([]);
  });
});
