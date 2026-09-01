// How the Whenever page divides itself.
//
// It shipped as two stacked sections, which reads well and scrolls badly: with
// forty tasks taken on, the "Someday, maybe" heading sits below all forty. Her
// report: "with many tasks it's quite hard to reach the Someday, maybe tasks."
//
// Collapsing the lower section would not have fixed it, which is the part worth
// remembering: a collapsed header is still underneath everything you were
// scrolling past. Only moving both to the top does, hence tabs.

import { describe, it, expect } from "vitest";
import type { Task } from "../../shared/types";

const t = (id: string, over: Partial<Task> = {}): Task =>
  ({ id, title: id, status: "todo", whenever: true, optional: false, ...over }) as Task;

// The split the page applies, kept here so the rule is pinned even though the
// page reads it inline.
const takingOn = (tasks: Task[]) => tasks.filter((x) => !x.optional);
const someday = (tasks: Task[]) => tasks.filter((x) => !!x.optional);

describe("Whenever's two halves", () => {
  const list = [
    t("pen", { optional: true }),
    t("article"),
    t("northern-lights", { optional: true }),
    t("n8n"),
  ];

  it("puts what she has taken on in one half and the maybes in the other", () => {
    expect(takingOn(list).map((x) => x.id)).toEqual(["article", "n8n"]);
    expect(someday(list).map((x) => x.id)).toEqual(["pen", "northern-lights"]);
  });

  it("partitions: every task lands in exactly one half", () => {
    const a = takingOn(list).map((x) => x.id);
    const b = someday(list).map((x) => x.id);
    expect([...a, ...b].sort()).toEqual(list.map((x) => x.id).sort());
    expect(a.filter((x) => b.includes(x))).toEqual([]);
  });

  it("is driven by `optional` alone, so promoting is one toggle", () => {
    const promoted = { ...list[0], optional: false };
    expect(takingOn([promoted]).map((x) => x.id)).toEqual(["pen"]);
    expect(someday([promoted])).toEqual([]);
  });

  it("copes with a half being empty", () => {
    expect(someday([t("a"), t("b")])).toEqual([]);
    expect(takingOn([t("a", { optional: true })])).toEqual([]);
  });
});
