// Checkbox MCP server: JSON-RPC 2.0 over HTTP (MCP streamable-HTTP transport).
// Mount at /mcp. Auth via Authorization: Bearer <token> (per-user or legacy).
//
// Two ways to authenticate, since different clients pass auth differently:
//   • Header: Authorization: Bearer <token>. Used by the local mcp-remote bridge
//     (Claude Desktop / Claude Code claude_desktop_config.json).
//   • Query:  ?token=<token>. Used by cloud-brokered connectors (Cowork /
//     claude.ai "Add custom connector"), whose UI only takes a URL + OAuth and
//     has no header field. The token rides in the registered URL instead.

import { Hono } from "hono";
import type { Bindings } from "../db";
import { resolveBearerUser, uuid, now } from "../db";
import { hydrateTasks } from "./_hydrate";
import { generateDayPlan } from "../lib/planner";
import { extractNoteTasks } from "../../shared/notes";
import { insertCandidates, type CandidateInput } from "./notes";
import { upsertMailCandidate, type MailCandidateInput } from "./mail";
import { nextDueDate } from "../../shared/recurrence";
import { pushTaskToGcal, deleteTaskGcalEvent } from "../lib/sync";
import { enforceProjectArea } from "../lib/section";

export const mcp = new Hono<{ Bindings: Bindings }>();

// ── Auth ───────────────────────────────────────────────────────────────────────

// Effective Authorization header for a request: the real header if present, else
// a synthetic one built from a ?token= query param (cloud connectors can't set
// headers). Header wins so an explicit bearer is never overridden.
function authHeaderFor(header: string | undefined, queryToken: string | undefined): string | undefined {
  if (header) return header;
  if (queryToken) return `Bearer ${queryToken}`;
  return undefined;
}

// Resolve the MCP caller to a user_id via their bearer token (per-user tokens in
// mcp_tokens, or the legacy MCP_AUTH_TOKEN -> owner). Returns null when the token
// is missing/unknown. Dev-open fallback: if nothing is configured at all (no
// MCP_AUTH_TOKEN and no per-user tokens), map to the owner for local development.
async function mcpUser(
  env: Bindings,
  header: string | undefined
): Promise<string | null> {
  const uid = await resolveBearerUser(env, header);
  if (uid) return uid;
  if (!env.MCP_AUTH_TOKEN) {
    const anyToken = await env.DB.prepare(
      "SELECT 1 FROM mcp_tokens LIMIT 1"
    ).first();
    if (!anyToken) {
      const owner = await env.DB.prepare(
        "SELECT id FROM users ORDER BY created_at LIMIT 1"
      ).first<{ id: string }>();
      return owner?.id ?? null;
    }
  }
  return null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function ok(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
function err(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// Brussels today as YYYY-MM-DD
function todayBrussels(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function text(s: string) {
  return { content: [{ type: "text", text: s }] };
}
function json(v: unknown) {
  return text(JSON.stringify(v, null, 2));
}

// Does this task belong to the caller? Gate every subtask/dependency write on it
// so the single-user isolation pattern holds even over MCP.
async function ownsTask(
  db: D1Database,
  userId: string,
  id: string
): Promise<boolean> {
  const r = await db
    .prepare("SELECT 1 FROM tasks WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first();
  return !!r;
}

// Upsert labels by name (creating any that don't exist) and attach them to a task.
// replace=true clears the task's current labels first, so update_task's label_names
// sets the exact set rather than appending. Shared by create_task and update_task.
async function syncLabels(
  db: D1Database,
  userId: string,
  taskId: string,
  names: unknown[],
  replace: boolean
): Promise<void> {
  if (replace) {
    await db.prepare("DELETE FROM task_labels WHERE task_id = ?").bind(taskId).run();
  }
  for (const raw of names) {
    const name = String(raw).trim();
    if (!name) continue;
    let lbl = await db
      .prepare("SELECT id FROM labels WHERE user_id = ? AND name = ?")
      .bind(userId, name)
      .first<{ id: string }>();
    if (!lbl) {
      const lid = uuid();
      await db
        .prepare("INSERT INTO labels (id, user_id, name) VALUES (?, ?, ?)")
        .bind(lid, userId, name)
        .run();
      lbl = { id: lid };
    }
    await db
      .prepare("INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)")
      .bind(taskId, lbl.id)
      .run();
  }
}

// Columns create_task / update_task may write directly (labels + id are handled
// separately). Shared so both paths accept the exact same field set.
const TASK_WRITABLE = [
  "title", "notes", "priority", "due_date", "due_time",
  "time_estimate_min", "scheduled_start", "scheduled_end",
  "area_id", "project_id", "parent_task_id", "section_id", "board_column",
  "status", "recurrence", "recurrence_mode", "planned_date",
  "gmail_thread_id", "gmail_message_id", "gmail_permalink",
] as const;

// Insert one task from a create-shaped args object and attach any label_names.
// Returns the new id. Shared by create_task and create_tasks.
async function createOneTask(
  db: D1Database,
  userId: string,
  args: Record<string, unknown>
): Promise<string> {
  const id = uuid();
  // This is where the drift came from: it inserts exactly the fields it is
  // handed, and naming a project without an area is the natural thing to do over
  // MCP ("put it in Brussels: Social & Network"). 53 tasks arrived that way and
  // rendered untinted next to identical tinted ones. See lib/section.ts.
  await enforceProjectArea(db, userId, args);
  const present = TASK_WRITABLE.filter((f) => f in args);
  const cols = ["id", "user_id", ...present];
  const vals = [id, userId, ...present.map((f) => args[f])];
  await db
    .prepare(`INSERT INTO tasks (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
    .bind(...vals)
    .run();
  if (Array.isArray(args.label_names)) {
    await syncLabels(db, userId, id, args.label_names as unknown[], false);
  }
  return id;
}

// ── Tool definitions ───────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "list_tasks",
    description:
      "List tasks. Use `view` for smart views (today/upcoming/overdue/backlog/logbook), or filter by project_id/area_id/status.",
    inputSchema: {
      type: "object",
      properties: {
        view: {
          type: "string",
          enum: ["today", "upcoming", "overdue", "backlog", "logbook"],
          description: "Smart view filter",
        },
        project_id: { type: "string" },
        area_id: { type: "string" },
        status: { type: "string", enum: ["todo", "doing", "done"] },
        search: {
          type: "string",
          description: "Partial title match (case-insensitive)",
        },
      },
    },
  },
  {
    name: "create_task",
    description:
      "Create a new task. title is required. priority: 1=urgent 2=this-week 3=flexible 4=backlog. " +
      "For a recurring task set `recurrence` (e.g. 'daily', 'weekly:mon,wed', 'monthly', 'every:3:week'); " +
      "completing it rolls the due date forward instead of finishing it. To create a subtask card, pass parent_task_id " +
      "(note: this is different from the lightweight checklist items managed by create_subtask).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        notes: { type: "string" },
        priority: { type: "number", enum: [1, 2, 3, 4] },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        due_time: { type: "string", description: "HH:MM" },
        planned_date: {
          type: "string",
          description:
            "YYYY-MM-DD. 'I intend to work on this on this day.' Set to today's date to put the task in the Today view (this is how you 'add to Today'); it does NOT change the deadline.",
        },
        scheduled_start: {
          type: "string",
          description: "ISO datetime for time-block start",
        },
        scheduled_end: { type: "string" },
        time_estimate_min: { type: "number" },
        area_id: { type: "string" },
        project_id: { type: "string" },
        parent_task_id: {
          type: "string",
          description: "Make this a child card of another task",
        },
        section_id: { type: "string", description: "Section within a project" },
        board_column: {
          type: "string",
          description: "Kanban column name (must match one of the project's board_columns)",
        },
        recurrence: {
          type: "string",
          description:
            "Recurrence spec: daily | weekdays | weekly | monthly | yearly | weekly:<mon,tue,...> | every:<N>:day|week|month|year",
        },
        recurrence_mode: {
          type: "string",
          enum: ["fixed", "after_completion"],
          description:
            "fixed = advance from the due date; after_completion = advance from the completion day. Default fixed.",
        },
        label_names: {
          type: "array",
          items: { type: "string" },
          description: "Label names to attach (created if missing)",
        },
        gmail_thread_id: {
          type: "string",
          description:
            "If this task came from an email, the Gmail thread id, so the task can link back to it.",
        },
        gmail_message_id: { type: "string" },
        gmail_permalink: {
          type: "string",
          description: "Deep link to the Gmail thread (https://mail.google.com/...).",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "update_task",
    description:
      "Update one or more fields of an existing task. Only the fields you pass change. " +
      "label_names REPLACES the task's labels with exactly that set (pass [] to clear).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        notes: { type: "string" },
        priority: { type: "number", enum: [1, 2, 3, 4] },
        due_date: { type: "string" },
        due_time: { type: "string" },
        planned_date: {
          type: "string",
          description:
            "YYYY-MM-DD. 'I intend to work on this on this day.' Set to today's date to put the task in the Today view (this is how you 'add to Today'); it does NOT change the deadline. Pass an empty string to remove it.",
        },
        scheduled_start: { type: "string" },
        scheduled_end: { type: "string" },
        time_estimate_min: { type: "number" },
        area_id: { type: "string" },
        project_id: { type: "string" },
        parent_task_id: { type: "string" },
        section_id: { type: "string" },
        board_column: { type: "string" },
        status: { type: "string", enum: ["todo", "doing", "done"] },
        recurrence: {
          type: "string",
          description:
            "Recurrence spec (see create_task). Pass an empty string to remove recurrence.",
        },
        recurrence_mode: {
          type: "string",
          enum: ["fixed", "after_completion"],
        },
        label_names: {
          type: "array",
          items: { type: "string" },
          description: "Replaces the task's labels with exactly this set (created if missing).",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "complete_task",
    description: "Mark a task done (or un-done with done=false).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        done: { type: "boolean", default: true },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_task",
    description: "Permanently delete a task.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "reschedule_task",
    description: "Change the due date (and optionally time) of a task.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        due_date: {
          type: "string",
          description: "YYYY-MM-DD, or null to clear",
        },
        due_time: { type: "string", description: "HH:MM, or null to clear" },
      },
      required: ["id", "due_date"],
    },
  },
  {
    name: "schedule_block",
    description:
      "Time-block a task on the calendar by setting scheduled_start and scheduled_end. This also pushes an event to Google Calendar if connected.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        scheduled_start: {
          type: "string",
          description: "ISO datetime, e.g. 2026-07-01T14:00:00",
        },
        scheduled_end: { type: "string" },
      },
      required: ["id", "scheduled_start", "scheduled_end"],
    },
  },
  {
    name: "list_areas",
    description: "List all non-archived areas.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_projects",
    description: "List projects. Optionally filter by area_id or status.",
    inputSchema: {
      type: "object",
      properties: {
        area_id: { type: "string" },
        status: {
          type: "string",
          enum: ["active", "completed", "archived"],
        },
      },
    },
  },
  {
    name: "list_labels",
    description: "List all labels.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "triage_backlog",
    description:
      "Return all backlog tasks (no area/project assigned) together with available areas and projects. Use this to analyse the backlog and decide where each task belongs, then call apply_triage with your assignments.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "apply_triage",
    description:
      "Assign backlog tasks to areas or projects. Pass the list of assignments from your triage analysis.",
    inputSchema: {
      type: "object",
      properties: {
        assignments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              task_id: { type: "string" },
              area_id: { type: "string" },
              project_id: { type: "string" },
            },
            required: ["task_id"],
          },
        },
      },
      required: ["assignments"],
    },
  },
  {
    name: "plan_my_day",
    description:
      "Return today's tasks, overdue tasks, and calendar events so you can suggest a focused day plan.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "YYYY-MM-DD (defaults to today in Brussels time)",
        },
      },
    },
  },
  {
    name: "propose_day_plan",
    description:
      "Draft and persist a proposed time-blocked schedule for today (the ambient planner). Blocks today's open tasks around calendar meetings; the user accepts it with one tap in the app. Returns the proposed blocks.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "add_mail_candidates",
    description:
      "Gmail coverage: record a VERDICT for every email thread you reviewed, so the user can audit at a glance that nothing slipped. Call this once per planning run with one entry PER MESSAGE you looked at in the fetch window, including ones you deliberately skipped (pass verdict='skipped' with a one-line reason). This is what makes coverage provable: a thread with no row reads as 'never considered'. Set verdict='filed' and task_id when you created a task from it (also pass the same gmail_thread_id/message_id/permalink on create_task). Dedupe is on message_id and safe to re-run; a row a human has dismissed or filed is frozen and will not be overwritten.",
    inputSchema: {
      type: "object",
      properties: {
        candidates: {
          type: "array",
          description: "One entry per message reviewed.",
          items: {
            type: "object",
            properties: {
              thread_id: { type: "string" },
              message_id: { type: "string", description: "The specific message id (the dedupe key)." },
              from_addr: { type: "string" },
              subject: { type: "string" },
              snippet: { type: "string", description: "Gmail's snippet. Do NOT send bodies." },
              received_at: { type: "string", description: "ISO datetime." },
              permalink: { type: "string", description: "https://mail.google.com/... link to the thread." },
              verdict: {
                type: "string",
                enum: ["pending", "filed", "skipped"],
                description: "filed = you made a task; skipped = not task-worthy (give a reason); pending = unsure.",
              },
              reason: { type: "string", description: "One line: why filed or skipped." },
              task_id: { type: "string", description: "The task you created, when verdict='filed'." },
            },
            required: ["thread_id", "message_id"],
          },
        },
      },
      required: ["candidates"],
    },
  },
  {
    name: "scan_notes_for_tasks",
    description:
      "Bridge Obsidian notes into Checkbox. Pass the raw text of one or more vault notes; the server extracts unchecked `- [ ]` checkboxes and TODO/FIXME markers (with source path + line) and files them as pending candidates the user accepts into Backlog. Also pass any looser commitments you spotted (e.g. 'I should email Sam') via `commitments`. Deduplicated, safe to re-run. Returns how many new candidates were added.",
    inputSchema: {
      type: "object",
      properties: {
        notes: {
          type: "array",
          description: "The notes to scan.",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "Vault-relative path, e.g. 'Daily/2026-07-07.md'" },
              text: { type: "string", description: "The full raw markdown of the note" },
            },
            required: ["text"],
          },
        },
        commitments: {
          type: "array",
          description: "Looser action items you inferred (not literal checkboxes).",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              path: { type: "string" },
              line: { type: "number" },
              context: { type: "string" },
            },
            required: ["title"],
          },
        },
      },
    },
  },
  {
    name: "daily_brief",
    description:
      "Return a concise summary of today: task stats, what's due, what's overdue, and today's calendar events.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "YYYY-MM-DD (defaults to today)",
        },
      },
    },
  },
  {
    name: "weekly_review",
    description:
      "Return stats for the past week (completed, slipped) and upcoming tasks for the next 7 days.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_calendar",
    description: "Return cached Google Calendar events for a given date.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "YYYY-MM-DD (defaults to today)",
        },
      },
    },
  },

  // ── Structure: areas, projects, subtasks, dependencies (write tools) ────────
  {
    name: "get_task",
    description:
      "Return one task fully hydrated (labels, checklist subtasks, dependencies/blocks).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "create_tasks",
    description:
      "Batch-create multiple tasks in one call. Each item takes the same fields as create_task. Returns the created ids.",
    inputSchema: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
          description: "Array of task objects (same shape as create_task input).",
        },
      },
      required: ["tasks"],
    },
  },
  {
    name: "create_area",
    description: "Create an area (a permanent life bucket, e.g. Work, Health).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        color: { type: "string", description: "Palette key, e.g. sky/emerald/rose" },
        icon: { type: "string", description: "Icon key, e.g. briefcase/heart" },
      },
      required: ["name"],
    },
  },
  {
    name: "update_area",
    description: "Update an area's name, color, or icon.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        color: { type: "string" },
        icon: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "archive_area",
    description: "Archive an area (soft: it stops showing in lists but is not deleted).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "create_project",
    description:
      "Create a project (a board/sprint under an area). Kanban columns default to To do/Doing/Done.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        area_id: { type: "string" },
        description: { type: "string" },
        goal: { type: "string" },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        board_columns: {
          type: "array",
          items: { type: "string" },
          description: "Kanban column names, in order.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "update_project",
    description: "Update a project's fields (name, area, description, goal, dates, board_columns, status).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        area_id: { type: "string" },
        description: { type: "string" },
        goal: { type: "string" },
        status: { type: "string", enum: ["active", "completed", "archived"] },
        start_date: { type: "string" },
        due_date: { type: "string" },
        board_columns: { type: "array", items: { type: "string" } },
      },
      required: ["id"],
    },
  },
  {
    name: "archive_project",
    description: "Archive a project (sets status=archived; reversible via update_project).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "create_subtask",
    description: "Add a checklist subtask to a task.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        title: { type: "string" },
      },
      required: ["task_id", "title"],
    },
  },
  {
    name: "update_subtask",
    description: "Update a checklist subtask's title and/or done state.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        done: { type: "boolean" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_subtask",
    description: "Delete a checklist subtask.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "set_task_dependency",
    description:
      "Make one task depend on (be blocked by) another: task_id waits on depends_on_id. Rejects self-links and cycles.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        depends_on_id: { type: "string" },
      },
      required: ["task_id", "depends_on_id"],
    },
  },
  {
    name: "remove_task_dependency",
    description: "Remove a dependency link (task_id no longer waits on depends_on_id).",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        depends_on_id: { type: "string" },
      },
      required: ["task_id", "depends_on_id"],
    },
  },

  // ── Cadence trackers ────────────────────────────────────────────────────────
  // Things measured by "how long since", not "due when". Answering "when did I
  // last call mum?" and logging it afterwards are the two things worth doing
  // from a chat, which is why these three exist and nothing more.
  {
    name: "list_trackers",
    description:
      "List cadence trackers with how long it has been since each was last done. Use for questions like 'who have I not spoken to in a while' or 'when did I last call X'. `days_since` is null when it has never been logged; `target_days` is null when the tracker is only counting and has no cadence to be late against.",
    inputSchema: {
      type: "object",
      properties: {
        area_id: { type: "string", description: "Only trackers filed under this area." },
        due_only: {
          type: "boolean",
          description: "Only those at or past their target cadence, or never logged.",
        },
      },
    },
  },
  {
    name: "log_tracker",
    description:
      "Record that a tracker happened, which resets its counter. Use when told something like 'I just called Ivka'. Defaults to now; pass occurred_at to backdate.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Tracker id (from list_trackers)." },
        occurred_at: {
          type: "string",
          description: "ISO datetime, or YYYY-MM-DD. Defaults to now.",
        },
        note: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "create_tracker",
    description:
      "Start tracking something by how long since it last happened (a person to keep in touch with, a plant, a backup). Omit target_days to count without a cadence.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        target_days: {
          type: "number",
          description: "Desired interval in days. Omit for no target.",
        },
        area_id: { type: "string" },
        kind: {
          type: "string",
          description: "contact | habit | maintenance | health. Label only.",
        },
        last_at: {
          type: "string",
          description: "ISO datetime of the last occurrence, if it already happened.",
        },
      },
      required: ["name"],
    },
  },
] as const;

// ── Tool handlers ──────────────────────────────────────────────────────────────

// Today in the user's zone. Same shape as the copies in views/filters/stats.
function todayStr(tz = "Europe/Brussels") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Whole calendar days between two YYYY-MM-DD days. UTC construction so a DST
// boundary cannot make a day 23 or 25 hours long and round the wrong way.
// Mirrors client/lib/cadence.ts daysBetween; keep the two in step.
function daysBetweenDays(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

// Fields whose change means the Google Calendar event must be reconciled.
const GCAL_FIELDS = ["scheduled_start", "scheduled_end", "due_date", "due_time", "title"];

// Best-effort GCal reconcile after a task write. Awaited (MCP has no waitUntil)
// but wrapped so a Google hiccup never fails the tool call. pushTaskToGcal now
// also removes the event when a task is unscheduled.
async function gcalSync(env: Bindings, userId: string, id: string): Promise<void> {
  await pushTaskToGcal(env, id, userId).catch((e) => console.error("mcp gcal sync:", e));
}

// Why a block might not have reached Google: no account at all, or an account
// whose refresh token expired/was revoked. Either way the write silently no-ops,
// so say so in the tool response rather than letting it look successful.
async function calendarWarning(
  env: Bindings,
  userId: string
): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT last_error FROM calendar_accounts WHERE user_id = ? LIMIT 1"
  )
    .bind(userId)
    .first<{ last_error: string | null }>();
  if (!row) {
    return " NOTE: no Google Calendar is connected, so this block was NOT pushed to Google. Connect one in Checkbox under Settings > Google Calendar.";
  }
  if (row.last_error) {
    return " NOTE: Google Calendar sync is broken (the saved token expired or was revoked), so this block was NOT pushed. Reconnect in Checkbox under Settings > Google Calendar.";
  }
  return "";
}

async function handleTool(
  name: string,
  args: Record<string, unknown>,
  env: Bindings,
  userId: string
): Promise<unknown> {
  const db = env.DB;

  switch (name) {
    // ── list_tasks ──────────────────────────────────────────────────────────
    case "list_tasks": {
      const today = todayBrussels();
      let sql: string;
      const binds: unknown[] = [userId];

      if (args.view === "today") {
        // Must match the app's Today view (routes/views.ts): due today or
        // overdue, scheduled today, OR planned for today, excluding subtasks and
        // snoozed tasks. planned_date is how "add to Today" works, so a plan set
        // via update_task(planned_date) must be visible here.
        sql = `SELECT * FROM tasks WHERE user_id = ? AND status != 'done' AND parent_task_id IS NULL
               AND (due_date = ? OR due_date < ? OR substr(scheduled_start,1,10) = ? OR planned_date = ?)
               AND (snoozed_until IS NULL OR snoozed_until <= ?)
               ORDER BY priority, position`;
        binds.push(today, today, today, today, today);
      } else if (args.view === "upcoming") {
        sql = `SELECT * FROM tasks WHERE user_id = ? AND due_date > ? AND status != 'done'
               ORDER BY due_date, priority`;
        binds.push(today);
      } else if (args.view === "overdue") {
        sql = `SELECT * FROM tasks WHERE user_id = ? AND due_date < ? AND status != 'done'
               ORDER BY due_date, priority`;
        binds.push(today);
      } else if (args.view === "backlog") {
        sql = `SELECT * FROM tasks WHERE user_id = ? AND area_id IS NULL AND project_id IS NULL
               AND status != 'done' ORDER BY priority, position`;
      } else if (args.view === "logbook") {
        sql = `SELECT * FROM tasks WHERE user_id = ? AND status = 'done'
               ORDER BY completed_at DESC LIMIT 100`;
      } else {
        sql = `SELECT * FROM tasks WHERE user_id = ? AND parent_task_id IS NULL`;
        if (args.project_id) {
          sql += " AND project_id = ?";
          binds.push(args.project_id);
        }
        if (args.area_id) {
          sql += " AND area_id = ? AND project_id IS NULL";
          binds.push(args.area_id);
        }
        if (args.status) {
          sql += " AND status = ?";
          binds.push(args.status);
        } else {
          sql += " AND status != 'done'";
        }
        if (args.search) {
          sql += " AND title LIKE ?";
          binds.push(`%${args.search}%`);
        }
        sql += " ORDER BY priority, position";
      }

      const { results } = await db.prepare(sql).bind(...binds).all();
      const tasks = await hydrateTasks(db, results as Record<string, unknown>[]);
      return json({ tasks, count: tasks.length });
    }

    // ── create_task ─────────────────────────────────────────────────────────
    case "create_task": {
      const id = await createOneTask(db, userId, args);
      await gcalSync(env, userId, id);
      const row = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
      const [task] = await hydrateTasks(db, [row as Record<string, unknown>]);
      return text(
        `Created task "${(task as Record<string, unknown>).title}" (id: ${id}, priority: P${(task as Record<string, unknown>).priority})`
      );
    }

    // ── create_tasks (batch) ──────────────────────────────────────────────────
    case "create_tasks": {
      const items = Array.isArray(args.tasks) ? (args.tasks as Record<string, unknown>[]) : [];
      if (!items.length) return text("No tasks provided.");
      const ids: string[] = [];
      for (const it of items) {
        if (!it || typeof it.title !== "string" || !it.title.trim()) continue;
        ids.push(await createOneTask(db, userId, it));
      }
      for (const id of ids) await gcalSync(env, userId, id);
      return json({ created: ids.length, ids });
    }

    // ── get_task ──────────────────────────────────────────────────────────────
    case "get_task": {
      const row = await db.prepare(
        "SELECT * FROM tasks WHERE id = ? AND user_id = ?"
      ).bind(args.id, userId).first();
      if (!row) return text(`Task ${args.id} not found.`);
      const [task] = await hydrateTasks(db, [row as Record<string, unknown>]);
      return json({ task });
    }

    // ── update_task ─────────────────────────────────────────────────────────
    case "update_task": {
      const id = args.id as string;
      if (!(await ownsTask(db, userId, id))) return text(`Task ${id} not found.`);
      // Moving a task into a project moves it into that project's area too.
      await enforceProjectArea(db, userId, args);
      const fields = TASK_WRITABLE.filter((f) => f in args);
      if (fields.length) {
        const set = fields.map((f) => `${f} = ?`).join(", ");
        await db.prepare(
          `UPDATE tasks SET ${set}, updated_at = ? WHERE id = ? AND user_id = ?`
        ).bind(...fields.map((f) => args[f]), now(), id, userId).run();
      }
      // label_names replaces the task's label set (pass [] to clear).
      if (Array.isArray(args.label_names)) {
        await syncLabels(db, userId, id, args.label_names as unknown[], true);
      }
      if (fields.some((f) => GCAL_FIELDS.includes(f))) await gcalSync(env, userId, id);
      return text(`Updated task ${id}.`);
    }

    // ── complete_task ────────────────────────────────────────────────────────
    case "complete_task": {
      const id = args.id as string;
      const done = args.done !== false;

      // Recurring tasks roll forward instead of completing (mirrors the app's
      // /tasks/:id/complete): advance the due date to the next occurrence, stay
      // todo, and reset the checklist. fixed = from the due date; after_completion
      // = from today.
      if (done) {
        const t = await db.prepare(
          "SELECT recurrence, recurrence_mode, due_date FROM tasks WHERE id = ? AND user_id = ?"
        ).bind(id, userId).first<{
          recurrence: string | null;
          recurrence_mode: string | null;
          due_date: string | null;
        }>();
        if (t?.recurrence) {
          const anchor =
            t.recurrence_mode === "after_completion"
              ? todayBrussels()
              : t.due_date ?? todayBrussels();
          const next = nextDueDate(t.recurrence, anchor);
          if (next) {
            await db.prepare(
              "UPDATE tasks SET due_date = ?, status = 'todo', completed_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?"
            ).bind(next, now(), id, userId).run();
            await db.prepare("UPDATE subtasks SET done = 0 WHERE task_id = ?").bind(id).run();
            await gcalSync(env, userId, id);
            return text(`Task ${id} recurred: next due ${next}.`);
          }
        }
      }

      await db.prepare(
        "UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?"
      ).bind(done ? "done" : "todo", done ? now() : null, now(), id, userId).run();
      // Re-completing keeps the event; un-completing re-pushes it.
      await gcalSync(env, userId, id);
      return text(`Task ${id} marked ${done ? "done" : "todo"}.`);
    }

    // ── delete_task ──────────────────────────────────────────────────────────
    case "delete_task": {
      const id = args.id as string;
      // Capture GCal linkage before deletion so we can remove the event too.
      const linked = await db.prepare(
        "SELECT gcal_event_id, gcal_calendar_id FROM tasks WHERE id = ? AND user_id = ?"
      )
        .bind(id, userId)
        .first<{ gcal_event_id: string | null; gcal_calendar_id: string | null }>();
      await db.prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?")
        .bind(id, userId).run();
      if (linked?.gcal_event_id) {
        await deleteTaskGcalEvent(
          env,
          linked.gcal_event_id,
          linked.gcal_calendar_id,
          userId
        ).catch((e) => console.error("mcp gcal delete:", e));
      }
      return text(`Task ${id} deleted.`);
    }

    // ── reschedule_task ──────────────────────────────────────────────────────
    case "reschedule_task": {
      await db.prepare(
        "UPDATE tasks SET due_date = ?, due_time = ?, updated_at = ? WHERE id = ? AND user_id = ?"
      ).bind(args.due_date ?? null, args.due_time ?? null, now(), args.id, userId).run();
      await gcalSync(env, userId, args.id as string);
      return text(`Rescheduled task ${args.id} to ${args.due_date ?? "no date"}.`);
    }

    // ── schedule_block ───────────────────────────────────────────────────────
    case "schedule_block": {
      await db.prepare(
        "UPDATE tasks SET scheduled_start = ?, scheduled_end = ?, updated_at = ? WHERE id = ? AND user_id = ?"
      ).bind(args.scheduled_start, args.scheduled_end, now(), args.id, userId).run();
      await gcalSync(env, userId, args.id as string);
      return text(
        `Blocked task ${args.id} from ${args.scheduled_start} to ${args.scheduled_end}.` +
          (await calendarWarning(env, userId))
      );
    }

    // ── list_areas ───────────────────────────────────────────────────────────
    case "list_areas": {
      const { results } = await db.prepare(
        "SELECT * FROM areas WHERE user_id = ? AND archived_at IS NULL ORDER BY position"
      ).bind(userId).all();
      return json({ areas: results });
    }

    // ── list_projects ────────────────────────────────────────────────────────
    case "list_projects": {
      let sql = "SELECT * FROM projects WHERE user_id = ?";
      const binds: unknown[] = [userId];
      if (args.area_id) { sql += " AND area_id = ?"; binds.push(args.area_id); }
      if (args.status) { sql += " AND status = ?"; binds.push(args.status); }
      else { sql += " AND status = 'active'"; }
      sql += " ORDER BY position";
      const { results } = await db.prepare(sql).bind(...binds).all();
      return json({ projects: results });
    }

    // ── list_labels ──────────────────────────────────────────────────────────
    case "list_labels": {
      const { results } = await db.prepare(
        "SELECT * FROM labels WHERE user_id = ? ORDER BY name"
      ).bind(userId).all();
      return json({ labels: results });
    }

    // ── triage_backlog ───────────────────────────────────────────────────────
    case "triage_backlog": {
      const [backlogRes, areasRes, projectsRes] = await Promise.all([
        db.prepare(
          `SELECT * FROM tasks WHERE user_id = ? AND area_id IS NULL AND project_id IS NULL
           AND status != 'done' ORDER BY priority, created_at`
        ).bind(userId).all(),
        db.prepare(
          "SELECT id, name, color FROM areas WHERE user_id = ? AND archived_at IS NULL ORDER BY position"
        ).bind(userId).all(),
        db.prepare(
          "SELECT id, name, area_id FROM projects WHERE user_id = ? AND status = 'active' ORDER BY position"
        ).bind(userId).all(),
      ]);

      const tasks = await hydrateTasks(
        db,
        backlogRes.results as Record<string, unknown>[]
      );

      return json({
        backlog_count: tasks.length,
        backlog_tasks: tasks.map((t) => {
          const r = t as Record<string, unknown>;
          return {
            id: r.id,
            title: r.title,
            notes: r.notes,
            priority: r.priority,
            due_date: r.due_date,
            labels: (r.labels as { name: string }[] | undefined)?.map(
              (l) => l.name
            ),
          };
        }),
        available_areas: areasRes.results,
        available_projects: projectsRes.results,
        instructions:
          "Analyse each backlog task. For each one, decide the best area_id and/or project_id from the available lists, then call apply_triage with your assignments.",
      });
    }

    // ── apply_triage ─────────────────────────────────────────────────────────
    case "apply_triage": {
      const assignments = args.assignments as {
        task_id: string;
        area_id?: string;
        project_id?: string;
      }[];
      if (!assignments?.length) return text("No assignments provided.");

      const stmts = assignments.map((a) =>
        db.prepare(
          "UPDATE tasks SET area_id = ?, project_id = ?, updated_at = ? WHERE id = ? AND user_id = ?"
        ).bind(a.area_id ?? null, a.project_id ?? null, now(), a.task_id, userId)
      );
      await db.batch(stmts);
      return text(`Applied ${assignments.length} triage assignment(s).`);
    }

    // ── plan_my_day ──────────────────────────────────────────────────────────
    case "plan_my_day": {
      const date = (args.date as string | undefined) ?? todayBrussels();
      const nextDay = new Date(date + "T00:00:00Z");
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayStr = nextDay.toISOString().slice(0, 10);

      const [todayRes, overdueRes, eventsRes] = await Promise.all([
        db.prepare(
          `SELECT * FROM tasks WHERE user_id = ? AND status != 'done'
           AND (due_date = ? OR DATE(scheduled_start) = ?) ORDER BY priority, position`
        ).bind(userId, date, date).all(),
        db.prepare(
          `SELECT id, title, priority, due_date FROM tasks
           WHERE user_id = ? AND due_date < ? AND status != 'done' ORDER BY due_date LIMIT 20`
        ).bind(userId, date).all(),
        db.prepare(
          `SELECT title, start, end, all_day, is_checkbox_owned FROM calendar_events_cache
           WHERE user_id = ? AND NOT all_day AND start >= ? AND start < ? ORDER BY start`
        ).bind(userId, date + "T00:00:00.000Z", nextDayStr + "T00:00:00.000Z").all(),
      ]);

      const tasks = await hydrateTasks(
        db,
        todayRes.results as Record<string, unknown>[]
      );

      return json({
        date,
        due_or_scheduled_today: tasks,
        overdue_tasks: overdueRes.results,
        calendar_events: eventsRes.results.map((e) => ({
          ...e,
          all_day: e.all_day === 1,
          is_checkbox_owned: e.is_checkbox_owned === 1,
        })),
        time_slots_hint:
          "Review the calendar events to find free blocks. Schedule the highest-priority tasks into those blocks using schedule_block.",
      });
    }

    // ── propose_day_plan ───────────────────────────────────────────────────────
    case "propose_day_plan": {
      const res = await generateDayPlan(env, userId);
      if (!res)
        return json({
          proposed: false,
          note: "Today's plan was already accepted or dismissed; not overwriting.",
        });
      return json({
        proposed: true,
        plan_id: res.id,
        date: res.plan.date,
        blocks: res.plan.blocks,
        unscheduled: res.plan.unscheduled,
        note: "Draft saved. The user can accept it in the app to write the time-blocks.",
      });
    }

    // ── scan_notes_for_tasks ───────────────────────────────────────────────────
    case "scan_notes_for_tasks": {
      const inputNotes =
        (args.notes as { path?: string; text: string }[] | undefined) ?? [];
      const commitments =
        (args.commitments as
          | { title: string; path?: string; line?: number; context?: string }[]
          | undefined) ?? [];

      const candidates: CandidateInput[] = [];
      for (const note of inputNotes) {
        for (const t of extractNoteTasks(note.text ?? "")) {
          candidates.push({
            title: t.title,
            source_path: note.path ?? null,
            source_line: t.line,
            kind: t.kind,
            context: t.context,
          });
        }
      }
      for (const cmt of commitments) {
        candidates.push({
          title: cmt.title,
          source_path: cmt.path ?? null,
          source_line: cmt.line ?? null,
          kind: "commitment",
          context: cmt.context ?? null,
        });
      }

      const added = await insertCandidates(db, userId, candidates);
      return json({
        scanned_notes: inputNotes.length,
        found: candidates.length,
        added,
        skipped_duplicates: candidates.length - added,
        note: "New candidates are pending in the app's Backlog → 'From your notes' inbox for the user to accept or reject.",
      });
    }

    // ── add_mail_candidates ────────────────────────────────────────────────────
    case "add_mail_candidates": {
      const items = Array.isArray(args.candidates)
        ? (args.candidates as MailCandidateInput[])
        : [];
      let created = 0;
      let updated = 0;
      let skipped = 0;
      for (const it of items) {
        if (!it || typeof it.thread_id !== "string" || typeof it.message_id !== "string") {
          skipped++;
          continue;
        }
        const r = await upsertMailCandidate(db, userId, { ...it, source: "planner" });
        if (r.created) created++;
        else updated++;
      }
      return json({
        received: items.length,
        created,
        updated,
        skipped_invalid: skipped,
        note: "Coverage recorded. Rows a human has dismissed or filed were left frozen. The user reviews these in the app's Mail coverage panel.",
      });
    }

    // ── daily_brief ──────────────────────────────────────────────────────────
    case "daily_brief": {
      const date = (args.date as string | undefined) ?? todayBrussels();
      const nextDay = new Date(date + "T00:00:00Z");
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayStr = nextDay.toISOString().slice(0, 10);

      const [dueRes, overdueRes, completedRes, eventsRes] = await Promise.all([
        db.prepare(
          `SELECT id, title, priority, status, due_time, scheduled_start, time_estimate_min
           FROM tasks WHERE user_id = ? AND (due_date = ? OR DATE(scheduled_start) = ?)
           ORDER BY priority, position`
        ).bind(userId, date, date).all(),
        db.prepare(
          "SELECT COUNT(*) as cnt FROM tasks WHERE user_id = ? AND due_date < ? AND status != 'done'"
        ).bind(userId, date).first<{ cnt: number }>(),
        db.prepare(
          "SELECT COUNT(*) as cnt FROM tasks WHERE user_id = ? AND DATE(completed_at) = ?"
        ).bind(userId, date).first<{ cnt: number }>(),
        db.prepare(
          `SELECT title, start, end FROM calendar_events_cache
           WHERE user_id = ? AND NOT all_day AND start >= ? AND start < ? ORDER BY start`
        ).bind(userId, date + "T00:00:00.000Z", nextDayStr + "T00:00:00.000Z").all(),
      ]);

      const dueTasks = dueRes.results as Record<string, unknown>[];
      const remaining = dueTasks.filter((t) => t.status !== "done").length;
      const doneToday = dueTasks.filter((t) => t.status === "done").length;

      return json({
        date,
        summary: {
          due_today: dueTasks.length,
          done_of_due: doneToday,
          remaining,
          overdue: overdueRes?.cnt ?? 0,
          completed_today: completedRes?.cnt ?? 0,
        },
        due_today: dueTasks,
        meetings: eventsRes.results,
      });
    }

    // ── weekly_review ────────────────────────────────────────────────────────
    case "weekly_review": {
      const today = todayBrussels();
      const weekAgo = new Date(today + "T00:00:00Z");
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAgoStr = weekAgo.toISOString().slice(0, 10);
      const weekAhead = new Date(today + "T00:00:00Z");
      weekAhead.setDate(weekAhead.getDate() + 7);
      const weekAheadStr = weekAhead.toISOString().slice(0, 10);

      const [completedRes, slippedRes, upcomingRes] = await Promise.all([
        db.prepare(
          `SELECT id, title, priority, completed_at FROM tasks
           WHERE user_id = ? AND status = 'done' AND completed_at >= ?
           ORDER BY completed_at DESC`
        ).bind(userId, weekAgoStr + "T00:00:00.000Z").all(),
        db.prepare(
          `SELECT id, title, priority, due_date FROM tasks
           WHERE user_id = ? AND due_date >= ? AND due_date < ? AND status != 'done'
           ORDER BY due_date, priority`
        ).bind(userId, weekAgoStr, today).all(),
        db.prepare(
          `SELECT id, title, priority, due_date FROM tasks
           WHERE user_id = ? AND due_date >= ? AND due_date <= ? AND status != 'done'
           ORDER BY due_date, priority`
        ).bind(userId, today, weekAheadStr).all(),
      ]);

      return json({
        period: { from: weekAgoStr, to: today },
        stats: {
          completed: completedRes.results.length,
          slipped: slippedRes.results.length,
          upcoming_next_7_days: upcomingRes.results.length,
        },
        completed_tasks: completedRes.results,
        slipped_tasks: slippedRes.results,
        upcoming_tasks: upcomingRes.results,
      });
    }

    // ── get_calendar ─────────────────────────────────────────────────────────
    case "get_calendar": {
      const date = (args.date as string | undefined) ?? todayBrussels();
      const next = new Date(date + "T00:00:00Z");
      next.setDate(next.getDate() + 1);
      const nextStr = next.toISOString().slice(0, 10);

      const [timedRes, allDayRes] = await Promise.all([
        db.prepare(
          `SELECT gcal_event_id, title, start, end, is_checkbox_owned, task_id
           FROM calendar_events_cache
           WHERE user_id = ? AND NOT all_day AND start >= ? AND start < ?
           ORDER BY start`
        ).bind(userId, date + "T00:00:00.000Z", nextStr + "T00:00:00.000Z").all(),
        db.prepare(
          `SELECT gcal_event_id, title, start FROM calendar_events_cache
           WHERE user_id = ? AND all_day AND start = ?`
        ).bind(userId, date).all(),
      ]);

      return json({
        date,
        all_day_events: allDayRes.results,
        timed_events: timedRes.results.map((e) => ({
          ...e,
          is_checkbox_owned: e.is_checkbox_owned === 1,
        })),
      });
    }

    // ── create_area ───────────────────────────────────────────────────────────
    case "create_area": {
      const nm = String(args.name ?? "").trim();
      if (!nm) return text("name required.");
      const id = uuid();
      await db.prepare(
        "INSERT INTO areas (id, user_id, name, color, icon) VALUES (?, ?, ?, ?, ?)"
      ).bind(id, userId, nm, args.color ?? null, args.icon ?? null).run();
      return text(`Created area "${nm}" (id: ${id}).`);
    }

    // ── update_area ───────────────────────────────────────────────────────────
    case "update_area": {
      const fields = ["name", "color", "icon"].filter((f) => f in args);
      if (!fields.length) return text("No fields to update.");
      const set = fields.map((f) => `${f} = ?`).join(", ");
      const res = await db.prepare(
        `UPDATE areas SET ${set}, updated_at = ? WHERE id = ? AND user_id = ?`
      ).bind(...fields.map((f) => args[f]), now(), args.id, userId).run();
      if (!res.meta.changes) return text(`Area ${args.id} not found.`);
      return text(`Updated area ${args.id}.`);
    }

    // ── archive_area ──────────────────────────────────────────────────────────
    case "archive_area": {
      const res = await db.prepare(
        "UPDATE areas SET archived_at = ?, updated_at = ? WHERE id = ? AND user_id = ?"
      ).bind(now(), now(), args.id, userId).run();
      if (!res.meta.changes) return text(`Area ${args.id} not found.`);
      return text(`Archived area ${args.id}.`);
    }

    // ── create_project ────────────────────────────────────────────────────────
    case "create_project": {
      const nm = String(args.name ?? "").trim();
      if (!nm) return text("name required.");
      if (args.area_id) {
        const a = await db.prepare(
          "SELECT 1 FROM areas WHERE id = ? AND user_id = ?"
        ).bind(args.area_id, userId).first();
        if (!a) return text(`area_id ${args.area_id} not found.`);
      }
      const id = uuid();
      const cols = Array.isArray(args.board_columns) ? args.board_columns : ["To do", "Doing", "Done"];
      await db.prepare(
        `INSERT INTO projects (id, user_id, area_id, name, description, goal, due_date, board_columns)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id, userId, args.area_id ?? null, nm,
        args.description ?? null, args.goal ?? null, args.due_date ?? null,
        JSON.stringify(cols)
      ).run();
      return text(`Created project "${nm}" (id: ${id}).`);
    }

    // ── update_project ────────────────────────────────────────────────────────
    case "update_project": {
      if (args.area_id) {
        const a = await db.prepare(
          "SELECT 1 FROM areas WHERE id = ? AND user_id = ?"
        ).bind(args.area_id, userId).first();
        if (!a) return text(`area_id ${args.area_id} not found.`);
      }
      const patch: Record<string, unknown> = { ...args };
      if (Array.isArray(patch.board_columns)) patch.board_columns = JSON.stringify(patch.board_columns);
      const fields = [
        "name", "area_id", "description", "goal", "status",
        "start_date", "due_date", "board_columns",
      ].filter((f) => f in patch);
      if (!fields.length) return text("No fields to update.");
      const set = fields.map((f) => `${f} = ?`).join(", ");
      const res = await db.prepare(
        `UPDATE projects SET ${set}, updated_at = ? WHERE id = ? AND user_id = ?`
      ).bind(...fields.map((f) => patch[f]), now(), args.id, userId).run();
      if (!res.meta.changes) return text(`Project ${args.id} not found.`);
      // Tasks in a project carry its area_id too; re-home them on a move.
      if ("area_id" in patch) {
        await db.prepare(
          "UPDATE tasks SET area_id = ?, updated_at = ? WHERE project_id = ? AND user_id = ?"
        ).bind(patch.area_id ?? null, now(), args.id, userId).run();
      }
      return text(`Updated project ${args.id}.`);
    }

    // ── archive_project ───────────────────────────────────────────────────────
    case "archive_project": {
      const res = await db.prepare(
        "UPDATE projects SET status = 'archived', updated_at = ? WHERE id = ? AND user_id = ?"
      ).bind(now(), args.id, userId).run();
      if (!res.meta.changes) return text(`Project ${args.id} not found.`);
      return text(`Archived project ${args.id}.`);
    }

    // ── create_subtask ────────────────────────────────────────────────────────
    case "create_subtask": {
      const taskId = args.task_id as string;
      const title = String(args.title ?? "").trim();
      if (!title) return text("title required.");
      if (!(await ownsTask(db, userId, taskId))) return text(`Task ${taskId} not found.`);
      const pos = await db.prepare(
        "SELECT COALESCE(MAX(position) + 1, 0) AS p FROM subtasks WHERE task_id = ?"
      ).bind(taskId).first<{ p: number }>();
      const id = uuid();
      await db.prepare(
        "INSERT INTO subtasks (id, task_id, title, position) VALUES (?, ?, ?, ?)"
      ).bind(id, taskId, title, pos?.p ?? 0).run();
      return text(`Added subtask "${title}" (id: ${id}) to task ${taskId}.`);
    }

    // ── update_subtask ────────────────────────────────────────────────────────
    case "update_subtask": {
      const sets: string[] = [];
      const binds: unknown[] = [];
      if ("title" in args) { sets.push("title = ?"); binds.push(args.title); }
      if ("done" in args) { sets.push("done = ?"); binds.push(args.done ? 1 : 0); }
      if (!sets.length) return text("No fields to update.");
      // Isolation: only touch a subtask whose parent task is the caller's.
      const res = await db.prepare(
        `UPDATE subtasks SET ${sets.join(", ")}
         WHERE id = ? AND task_id IN (SELECT id FROM tasks WHERE user_id = ?)`
      ).bind(...binds, args.id, userId).run();
      if (!res.meta.changes) return text(`Subtask ${args.id} not found.`);
      return text(`Updated subtask ${args.id}.`);
    }

    // ── delete_subtask ────────────────────────────────────────────────────────
    case "delete_subtask": {
      const res = await db.prepare(
        `DELETE FROM subtasks
         WHERE id = ? AND task_id IN (SELECT id FROM tasks WHERE user_id = ?)`
      ).bind(args.id, userId).run();
      if (!res.meta.changes) return text(`Subtask ${args.id} not found.`);
      return text(`Deleted subtask ${args.id}.`);
    }

    // ── set_task_dependency ───────────────────────────────────────────────────
    case "set_task_dependency": {
      const taskId = args.task_id as string;
      const dep = args.depends_on_id as string;
      if (!dep || dep === taskId) return text("Invalid dependency (a task cannot depend on itself).");
      if (!(await ownsTask(db, userId, taskId)) || !(await ownsTask(db, userId, dep)))
        return text("Task not found.");
      const reverse = await db.prepare(
        "SELECT 1 FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?"
      ).bind(dep, taskId).first();
      if (reverse) return text("Rejected: that would create a cycle.");
      await db.prepare(
        "INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)"
      ).bind(taskId, dep).run();
      return text(`Task ${taskId} now waits on ${dep}.`);
    }

    // ── remove_task_dependency ────────────────────────────────────────────────
    case "remove_task_dependency": {
      const taskId = args.task_id as string;
      if (!(await ownsTask(db, userId, taskId))) return text(`Task ${taskId} not found.`);
      await db.prepare(
        "DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?"
      ).bind(taskId, args.depends_on_id).run();
      return text(`Removed dependency ${taskId} -> ${args.depends_on_id}.`);
    }

    // ── Cadence trackers ─────────────────────────────────────────────────────

    case "list_trackers": {
      const binds: unknown[] = [userId];
      let sql = `
        SELECT t.id, t.name, t.kind, t.target_days, t.area_id,
               (SELECT MAX(e.occurred_at) FROM tracker_events e WHERE e.tracker_id = t.id) AS last_at
          FROM trackers t
         WHERE t.user_id = ? AND t.archived = 0`;
      if (args.area_id) {
        sql += " AND t.area_id = ?";
        binds.push(args.area_id);
      }
      const { results } = await db.prepare(sql).bind(...binds).all<{
        id: string;
        name: string;
        kind: string;
        target_days: number | null;
        area_id: string | null;
        last_at: string | null;
      }>();

      // days_since is computed here rather than in SQL so it is CALENDAR days in
      // the user's zone, matching what the app shows. julianday() on a UTC
      // timestamp would disagree with the UI by a day around midnight.
      const today = todayStr();
      const rows = (results ?? []).map((r) => {
        const days = r.last_at ? daysBetweenDays(r.last_at.slice(0, 10), today) : null;
        return {
          ...r,
          days_since: days,
          // "Due" means at or past the cadence. A tracker with no target is never
          // due, however long it has been: that is what omitting a target means.
          due: r.target_days == null ? false : days == null || days >= r.target_days,
        };
      });

      const list = args.due_only ? rows.filter((r) => r.due) : rows;
      // Most neglected first, so the answer to "who should I call" is the top row.
      list.sort((a, b) => {
        const ra = a.target_days ? (a.days_since ?? Infinity) / a.target_days : -1;
        const rb = b.target_days ? (b.days_since ?? Infinity) / b.target_days : -1;
        return rb - ra;
      });
      return json({ trackers: list });
    }

    case "log_tracker": {
      const id = args.id as string;
      const owns = await db
        .prepare("SELECT name FROM trackers WHERE id = ? AND user_id = ?")
        .bind(id, userId)
        .first<{ name: string }>();
      if (!owns) return text(`Tracker ${id} not found.`);

      // A bare date is accepted for convenience ("I called her on the 14th") and
      // widened to midday, so a timezone shift cannot slide it to the wrong day.
      const raw = typeof args.occurred_at === "string" ? args.occurred_at : "";
      const occurredAt = !raw
        ? new Date().toISOString()
        : /^\d{4}-\d{2}-\d{2}$/.test(raw)
        ? `${raw}T12:00:00.000Z`
        : raw;

      await db
        .prepare(
          "INSERT INTO tracker_events (id, user_id, tracker_id, occurred_at, note) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(uuid(), userId, id, occurredAt, (args.note as string) ?? null)
        .run();
      return text(`Logged "${owns.name}" at ${occurredAt.slice(0, 10)}.`);
    }

    case "create_tracker": {
      const name = typeof args.name === "string" ? args.name.trim() : "";
      if (!name) return text("A name is required.");
      const target =
        typeof args.target_days === "number" && args.target_days > 0
          ? Math.round(args.target_days)
          : null;
      const id = uuid();
      await db
        .prepare(
          `INSERT INTO trackers (id, user_id, name, kind, target_days, area_id, position, created_at)
           VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(position) + 1 FROM trackers WHERE user_id = ?), 0), ?)`
        )
        .bind(
          id,
          userId,
          name,
          typeof args.kind === "string" && args.kind ? args.kind : "contact",
          target,
          (args.area_id as string) ?? null,
          userId,
          now()
        )
        .run();
      if (typeof args.last_at === "string" && args.last_at) {
        await db
          .prepare(
            "INSERT INTO tracker_events (id, user_id, tracker_id, occurred_at) VALUES (?, ?, ?, ?)"
          )
          .bind(uuid(), userId, id, args.last_at)
          .run();
      }
      return text(
        `Tracking "${name}"${target ? ` every ${target} days` : " (no target)"} (id: ${id}).`
      );
    }

    default:
      throw { code: -32601, message: `Unknown tool: ${name}` };
  }
}

// ── Route: POST /mcp ──────────────────────────────────────────────────────────

mcp.post("/", async (c) => {
  const userId = await mcpUser(
    c.env,
    authHeaderFor(c.req.header("Authorization"), c.req.query("token"))
  );
  if (!userId) {
    return c.json(err(null, -32000, "Unauthorized"), 401);
  }

  let body: { jsonrpc: string; id: unknown; method: string; params?: Record<string, unknown> };
  try {
    body = await c.req.json();
  } catch {
    return c.json(err(null, -32700, "Parse error"), 400);
  }

  const { id, method, params = {} } = body;

  // ── initialize ────────────────────────────────────────────────────────────
  if (method === "initialize") {
    return c.json(
      ok(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "checkbox", version: "3.1.0" },
      })
    );
  }

  // ── tools/list ────────────────────────────────────────────────────────────
  if (method === "tools/list") {
    return c.json(ok(id, { tools: TOOLS }));
  }

  // ── tools/call ────────────────────────────────────────────────────────────
  if (method === "tools/call") {
    const toolName = params.name as string;
    const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await handleTool(toolName, toolArgs, c.env, userId);
      return c.json(ok(id, result));
    } catch (e) {
      const msg =
        (e as { message?: string }).message ??
        (e instanceof Error ? e.message : "Internal error");
      return c.json(ok(id, { content: [{ type: "text", text: `Error: ${msg}` }], isError: true }));
    }
  }

  // ── notifications/initialized (no response expected) ─────────────────────
  if (method.startsWith("notifications/")) {
    return c.body(null, 204);
  }

  return c.json(err(id, -32601, `Method not found: ${method}`), 404);
});

// ── Route: GET /mcp (capability discovery) ───────────────────────────────────

mcp.get("/", (c) => {
  return c.json({
    name: "checkbox",
    version: "3.1.0",
    description: "Checkbox task manager MCP server",
    tools_count: TOOLS.length,
    auth: c.env.MCP_AUTH_TOKEN ? "bearer" : "none (dev mode)",
  });
});
