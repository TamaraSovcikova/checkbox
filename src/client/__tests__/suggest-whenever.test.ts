// A suggester that ignores a flag you set by hand teaches you to stop trusting
// the flag. "Whenever" means no deadline ever, so proposing one for TODAY is the
// single suggestion it exists to rule out.

import { describe, it, expect } from "vitest";
import { suggestForToday } from "../../shared/suggest";
import type { Task } from "../../shared/types";

const t = (over: Partial<Task>): Task =>
  ({
    id: "t",
    title: "t",
    status: "todo",
    priority: 2,
    due_date: null,
    planned_date: null,
    scheduled_start: null,
    snoozed_until: null,
    whenever: false,
    depends_on: [],
    subtasks: [],
    ...over,
  }) as Task;

const TODAY = "2026-09-01";

describe("suggestForToday and the whenever flag", () => {
  it("never suggests a whenever task", () => {
    const out = suggestForToday([t({ id: "someday", whenever: true })], TODAY);
    expect(out).toEqual([]);
  });

  it("still suggests the ordinary task beside it", () => {
    const out = suggestForToday(
      [t({ id: "someday", whenever: true }), t({ id: "real" })],
      TODAY
    );
    expect(out.map((s) => s.task.id)).toEqual(["real"]);
  });
});
