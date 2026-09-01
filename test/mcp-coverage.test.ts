// What the connector can actually reach.
//
// Her ask: "ensure the MCP has access to editing and creating all these fields
// on a task as well as subtasks and such." The gap was invisible from inside a
// chat: an agent asked to "mark this as waiting on Maxime" had no field for it
// and would do something else instead, confidently.
//
// This pins COVERAGE, not behaviour: the connector's writable set must not fall
// behind the app's. A field the sheet can set and the connector cannot is a
// field that silently does not exist over MCP.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = (f: string) =>
  readFileSync(join(__dirname, "..", "src", "worker", "routes", f), "utf8");

// The array literal after a given const name.
function writableSet(text: string, name: string): Set<string> {
  const i = text.indexOf(`const ${name}`);
  const open = text.indexOf("[", i);
  const close = text.indexOf("]", open);
  return new Set(
    [...text.slice(open, close).matchAll(/"([a-z_]+)"/g)].map((m) => m[1])
  );
}

describe("MCP task field coverage", () => {
  const mcp = writableSet(src("mcp.ts"), "TASK_WRITABLE");
  const rest = writableSet(src("tasks.ts"), "WRITABLE");

  it("can write every field she can set on a task in the app", () => {
    // Deliberate exceptions, each with a reason:
    //   position       list ordering, a drag-and-drop concern with no meaning
    //                  in a chat.
    //   gcal_hidden    set by hiding a chip in the calendar UI.
    //   checkpoint_*   owned by set_task_checkpoint, which computes the next
    //                  pulse rather than taking it raw.
    //   source_*       written by the vault sync, never by hand.
    const uiOnly = new Set([
      "position",
      "gcal_hidden",
      "checkpoint_days",
      "checkpoint_next",
      "source_path",
      "source_line",
      "source_text",
    ]);
    const missing = [...rest].filter((f) => !mcp.has(f) && !uiOnly.has(f));
    expect(missing).toEqual([]);
  });

  it("covers the fields that were missing when she asked", () => {
    for (const f of [
      "snoozed_until",
      "blocked_until",
      "waiting_on",
      "waiting_expected",
      "recurrence_until",
      "recurrence_count",
      "optional",
      "whenever",
      "planned_date",
    ])
      expect(mcp.has(f), `${f} is not writable over MCP`).toBe(true);
  });

  it("declares every writable date in the schema, not just in the array", () => {
    // A field the handler accepts but the schema never mentions is a field no
    // agent will ever pass: the schema IS the documentation it reads.
    const text = src("mcp.ts");
    for (const f of [
      "snoozed_until",
      "blocked_until",
      "waiting_on",
      "waiting_expected",
      "recurrence_until",
      "recurrence_count",
    ])
      expect(text.includes(`${f}: {`), `${f} has no schema entry`).toBe(true);
  });
});

describe("MCP subtask coverage", () => {
  const text = src("mcp.ts");

  it("can give a step its own due date and priority, on create and on update", () => {
    // A step's due date is not decoration: it carries the parent into Today and
    // the parent then renders AS that step. A connector that can only write
    // titles cannot express the thing steps are mainly for.
    const create = text.slice(text.indexOf('name: "create_subtask"'));
    expect(create.slice(0, 900)).toContain("due_date");
    expect(create.slice(0, 900)).toContain("priority");

    const update = text.slice(text.indexOf('case "update_subtask"'));
    expect(update.slice(0, 900)).toContain('"due_date" in args');
    expect(update.slice(0, 900)).toContain('"priority" in args');
  });

  it("treats null on a step as a real value rather than as absent", () => {
    // `in args` and not truthiness: null means "clear the date" / "inherit the
    // task's priority", and a truthiness check would drop both on the floor.
    const update = text.slice(text.indexOf('case "update_subtask"'), text.indexOf('case "delete_subtask"'));
    expect(update).toContain('"due_date" in args');
    expect(update).not.toContain("if (args.due_date)");
  });
});
