// Checkbox MCP server — JSON-RPC 2.0 over HTTP (MCP streamable-HTTP transport).
// Mount at /mcp. Auth via Authorization: Bearer <MCP_AUTH_TOKEN>.
// Add to Claude: Settings > MCP Servers > HTTP, URL = https://<worker>/mcp, token = <secret>.

import { Hono } from "hono";
import type { Bindings } from "../db";
import { getUserId, uuid, now } from "../db";
import { hydrateTasks } from "./_hydrate";

export const mcp = new Hono<{ Bindings: Bindings }>();

// ── Auth ───────────────────────────────────────────────────────────────────────

function checkAuth(env: Bindings, header: string | undefined): boolean {
  if (!env.MCP_AUTH_TOKEN) return true; // unconfigured = open (local dev only)
  return header === `Bearer ${env.MCP_AUTH_TOKEN}`;
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
      "Create a new task. title is required. priority: 1=urgent 2=this-week 3=flexible 4=backlog.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        notes: { type: "string" },
        priority: { type: "number", enum: [1, 2, 3, 4] },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        due_time: { type: "string", description: "HH:MM" },
        scheduled_start: {
          type: "string",
          description: "ISO datetime for time-block start",
        },
        scheduled_end: { type: "string" },
        time_estimate_min: { type: "number" },
        area_id: { type: "string" },
        project_id: { type: "string" },
        label_names: {
          type: "array",
          items: { type: "string" },
          description: "Label names to attach (created if missing)",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "update_task",
    description: "Update one or more fields of an existing task.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        notes: { type: "string" },
        priority: { type: "number", enum: [1, 2, 3, 4] },
        due_date: { type: "string" },
        due_time: { type: "string" },
        scheduled_start: { type: "string" },
        scheduled_end: { type: "string" },
        time_estimate_min: { type: "number" },
        area_id: { type: "string" },
        project_id: { type: "string" },
        status: { type: "string", enum: ["todo", "doing", "done"] },
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
] as const;

// ── Tool handlers ──────────────────────────────────────────────────────────────

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
        sql = `SELECT * FROM tasks WHERE user_id = ? AND status != 'done'
               AND (due_date = ? OR due_date < ? OR DATE(scheduled_start) = ?)
               ORDER BY priority, position`;
        binds.push(today, today, today);
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
      const FIELDS = [
        "title", "notes", "priority", "due_date", "due_time",
        "time_estimate_min", "scheduled_start", "scheduled_end",
        "area_id", "project_id", "status",
      ];
      const id = uuid();
      const cols = ["id", "user_id", ...FIELDS.filter((f) => f in args)];
      const vals = [id, userId, ...FIELDS.filter((f) => f in args).map((f) => args[f])];
      await db.prepare(
        `INSERT INTO tasks (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`
      ).bind(...vals).run();

      if (Array.isArray(args.label_names)) {
        for (const raw of args.label_names as string[]) {
          const name = String(raw).trim();
          if (!name) continue;
          let lbl = await db.prepare(
            "SELECT id FROM labels WHERE user_id = ? AND name = ?"
          ).bind(userId, name).first<{ id: string }>();
          if (!lbl) {
            const lid = uuid();
            await db.prepare("INSERT INTO labels (id, user_id, name) VALUES (?, ?, ?)")
              .bind(lid, userId, name).run();
            lbl = { id: lid };
          }
          await db.prepare("INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)")
            .bind(id, lbl.id).run();
        }
      }

      const row = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
      const [task] = await hydrateTasks(db, [row as Record<string, unknown>]);
      return text(
        `Created task "${(task as Record<string, unknown>).title}" (id: ${id}, priority: P${(task as Record<string, unknown>).priority})`
      );
    }

    // ── update_task ─────────────────────────────────────────────────────────
    case "update_task": {
      const id = args.id as string;
      const WRITABLE = [
        "title", "notes", "priority", "due_date", "due_time",
        "time_estimate_min", "scheduled_start", "scheduled_end",
        "area_id", "project_id", "status",
      ];
      const fields = WRITABLE.filter((f) => f in args);
      if (fields.length) {
        const set = fields.map((f) => `${f} = ?`).join(", ");
        await db.prepare(
          `UPDATE tasks SET ${set}, updated_at = ? WHERE id = ? AND user_id = ?`
        ).bind(...fields.map((f) => args[f]), now(), id, userId).run();
      }
      return text(`Updated task ${id}.`);
    }

    // ── complete_task ────────────────────────────────────────────────────────
    case "complete_task": {
      const id = args.id as string;
      const done = args.done !== false;
      await db.prepare(
        "UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?"
      ).bind(done ? "done" : "todo", done ? now() : null, now(), id, userId).run();
      return text(`Task ${id} marked ${done ? "done" : "todo"}.`);
    }

    // ── delete_task ──────────────────────────────────────────────────────────
    case "delete_task": {
      await db.prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?")
        .bind(args.id, userId).run();
      return text(`Task ${args.id} deleted.`);
    }

    // ── reschedule_task ──────────────────────────────────────────────────────
    case "reschedule_task": {
      await db.prepare(
        "UPDATE tasks SET due_date = ?, due_time = ?, updated_at = ? WHERE id = ? AND user_id = ?"
      ).bind(args.due_date ?? null, args.due_time ?? null, now(), args.id, userId).run();
      return text(`Rescheduled task ${args.id} to ${args.due_date ?? "no date"}.`);
    }

    // ── schedule_block ───────────────────────────────────────────────────────
    case "schedule_block": {
      await db.prepare(
        "UPDATE tasks SET scheduled_start = ?, scheduled_end = ?, updated_at = ? WHERE id = ? AND user_id = ?"
      ).bind(args.scheduled_start, args.scheduled_end, now(), args.id, userId).run();
      return text(
        `Blocked task ${args.id} from ${args.scheduled_start} to ${args.scheduled_end}.`
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

    default:
      throw { code: -32601, message: `Unknown tool: ${name}` };
  }
}

// ── Route: POST /mcp ──────────────────────────────────────────────────────────

mcp.post("/", async (c) => {
  if (!checkAuth(c.env, c.req.header("Authorization"))) {
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
        serverInfo: { name: "checkbox", version: "3.0.0" },
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
      const userId = await getUserId(c);
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
    version: "3.0.0",
    description: "Checkbox task manager MCP server",
    tools_count: TOOLS.length,
    auth: c.env.MCP_AUTH_TOKEN ? "bearer" : "none (dev mode)",
  });
});
