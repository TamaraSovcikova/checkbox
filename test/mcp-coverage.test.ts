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

// Whole FEATURES, not just task fields.
//
// The field-level test above catches a column the connector cannot write. It
// does not catch an entire feature the connector cannot see, which is what had
// happened with saved filters: a rich query language, five sessions of work, and
// no tool to list, run or build one. An agent asked "what is in my Week filter"
// had no way to answer and no way to say why.
//
// So this walks the app's route groups and asks, for each, whether the connector
// has any tool for it. The exceptions are listed WITH REASONS rather than as a
// count, because the next person adding a route needs to know whether theirs is
// like attachments (genuinely not a chat concern) or like saved filters (an
// oversight that lasted months).
describe("MCP feature coverage", () => {
  const mcpSrc = src("mcp.ts");
  const toolNames = [...mcpSrc.matchAll(/^    name: "([a-z_]+)"/gm)].map((m) => m[1]);

  // route group -> a tool name that covers it
  const COVERED: Record<string, string> = {
    areas: "list_areas",
    projects: "list_projects",
    tasks: "list_tasks",
    labels: "list_labels",
    views: "list_tasks",
    calendar: "get_calendar",
    triage: "triage_backlog",
    "saved-filters": "list_filters",
    review: "weekly_review",
    plans: "plan_my_day",
    notes: "scan_notes_for_tasks",
    mail: "add_mail_candidates",
    trackers: "list_trackers",
  };

  // Deliberately absent, each for a reason that would not change on a new
  // feature:
  //   auth / push / prefs   browser-side setup, nothing to ask an agent for.
  //   attachments           file upload is not something a chat does.
  //   stats                 weekly_review already carries the numbers.
  //   export                a download, not a conversation.
  //   gmail                 OAuth handshake; the mail TOOLS are add_mail_candidates.
  //   templates             not yet worth it, and named here so the next person
  //                         knows it was a decision rather than a miss.
  //   pins                  cards are a layout surface; an agent writing one has
  //                         no way to know where it should sit.
  const OUT_OF_SCOPE = [
    "auth",
    "prefs",
    "push",
    "attachments",
    "stats",
    "export",
    "gmail",
    "templates",
    "pins",
  ];

  it("has a tool for every route group that is not deliberately out of scope", () => {
    const index = readFileSync(
      join(__dirname, "..", "src", "worker", "index.ts"),
      "utf8"
    );
    const groups = [...index.matchAll(/app\.route\("\/api\/([a-z-]+)"/g)].map(
      (m) => m[1]
    );
    const uncovered = groups.filter(
      (g) => !COVERED[g] && !OUT_OF_SCOPE.includes(g)
    );
    expect(uncovered, "route groups with no MCP tool and no stated reason").toEqual([]);
  });

  it("the tools named as covering a group actually exist", () => {
    for (const [group, tool] of Object.entries(COVERED))
      expect(toolNames, `${group} claims ${tool}`).toContain(tool);
  });

  it("can run AND build a saved filter, not merely list them", () => {
    // Listing without running would have been a worse answer than nothing: it
    // would look like coverage.
    for (const t of ["list_filters", "run_filter", "save_filter", "delete_filter"])
      expect(toolNames).toContain(t);
  });

  it("can EDIT a tracker, not only create and log one", () => {
    expect(toolNames).toContain("update_tracker");
  });

  it("offers every view the app has, including the ones added late", () => {
    // list_tasks' enum is how an agent discovers these at all.
    const enumBlock = mcpSrc.slice(
      mcpSrc.indexOf('enum: [\n            "today"'),
      mcpSrc.indexOf('description:', mcpSrc.indexOf('enum: [\n            "today"'))
    );
    for (const v of ["today", "upcoming", "overdue", "backlog", "logbook", "whenever", "parked", "snoozed"])
      expect(enumBlock, `view ${v}`).toContain(`"${v}"`);
  });
});
