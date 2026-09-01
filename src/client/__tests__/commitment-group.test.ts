// Whenever holds two different claims, not one.
//
// Her distinction: a `whenever` task is something she is ACTIVELY trying to do,
// it just does not depend on anything, so she picks it up as she goes. A bucket
// list item is "learn a penspinning trick... whenever I get to it, IF I ever get
// to it". Same shape of task, no date either way; what differs is whether she
// has taken it on.
//
// That difference is already a field: `optional` means "a nice-to-have, not a
// commitment", and her real optional tasks read exactly that way ("PARKED:
// reopens only if the author path is ruled an income path"). So this is one
// list split in two, not a second system.

import { describe, it, expect } from "vitest";
import { groupTasks } from "../pages";
import type { Task } from "../../shared/types";

const t = (id: string, over: Partial<Task> = {}): Task =>
  ({ id, title: id, status: "todo", priority: 4, whenever: true, ...over }) as Task;

const names = { area: () => "No area", project: () => "No project" };
const group = (tasks: Task[]) => groupTasks(tasks, "commitment", names);

describe("commitment grouping", () => {
  it("puts what she has taken on before what she might never do", () => {
    const out = group([t("someday", { optional: true }), t("doing")]);
    expect(out.map((g) => g.label)).toEqual(["Taking these on", "Someday, maybe"]);
    expect(out[0].tasks.map((x) => x.id)).toEqual(["doing"]);
    expect(out[1].tasks.map((x) => x.id)).toEqual(["someday"]);
  });

  it("keeps the order fixed, whatever order the tasks arrive in", () => {
    // Alphabetical would put "Someday" first, which is backwards.
    const out = group([t("a", { optional: true }), t("b", { optional: true })]);
    expect(out.map((g) => g.label)).toEqual(["Someday, maybe"]);
    const out2 = group([t("c"), t("d", { optional: true })]);
    expect(out2.map((g) => g.label)).toEqual(["Taking these on", "Someday, maybe"]);
  });

  it("shows no empty section", () => {
    expect(group([t("a")]).map((g) => g.label)).toEqual(["Taking these on"]);
    expect(group([])).toEqual([]);
  });

  it("reads the flag, not the whenever-ness: it is a general axis", () => {
    // Any list can usefully separate what you are doing from what you are only
    // keeping, so this is not hardcoded to the Whenever view.
    const out = group([t("dated", { whenever: false, optional: true })]);
    expect(out[0].label).toBe("Someday, maybe");
  });
});
