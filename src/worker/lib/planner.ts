// Ambient AI planner (#30). Server-side day scheduler run by the 06:00 cron (and
// on demand via /api/plans/generate + the propose_day_plan MCP tool). Computes a
// proposed set of time-blocks for today's open tasks around calendar meetings and
// stores it as a day_plans row for the user to accept with one tap.

import { type Bindings, uuid } from "../db";
import { scheduleBlocks, DEFAULT_ESTIMATE_MIN } from "../../shared/schedule";
import { DEFAULT_TZ } from "../../shared/tz";

const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;

// The offset (ms) to add to a UTC instant to get wall-clock time in `tz`.
function tzOffsetMs(tz: string, atMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(atMs));
  const map: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = Number(p.value);
  const asUTC = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    map.hour === 24 ? 0 : map.hour,
    map.minute,
    map.second
  );
  return asUTC - atMs;
}

// Convert a wall-clock time (Y-M-D at `hour`:00 in `tz`) to a UTC epoch-ms.
function wallToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  tz: string
): number {
  const guess = Date.UTC(year, month - 1, day, hour);
  return guess - tzOffsetMs(tz, guess);
}

// today's YYYY-MM-DD in the given tz
function todayIn(tz: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz }).slice(0, 10);
}

export interface GeneratedPlan {
  date: string;
  blocks: {
    task_id: string;
    title: string;
    priority: number;
    start: string;
    end: string;
  }[];
  unscheduled: { id: string; title: string; priority: number }[];
}

// Compute today's proposed plan for a user (no DB writes). Returns null-free data.
export async function computeDayPlan(
  env: Bindings,
  userId: string,
  nowMs = Date.now()
): Promise<GeneratedPlan> {
  const tzRow = await env.DB.prepare(
    "SELECT timezone FROM users WHERE id = ?"
  )
    .bind(userId)
    .first<{ timezone: string | null }>();
  const tz = tzRow?.timezone || DEFAULT_TZ;
  const date = todayIn(tz);
  const [y, m, d] = date.split("-").map(Number);

  const dayStartMs = wallToUtcMs(y, m, d, WORK_START_HOUR, tz);
  const dayEndMs = wallToUtcMs(y, m, d, WORK_END_HOUR, tz);
  const windowStartMs = Math.max(nowMs, dayStartMs);

  const nextDay = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);

  // Open, non-snoozed tasks due today or overdue (the day's real work).
  const { results: taskRows } = await env.DB.prepare(
    `SELECT id, title, priority, due_time, time_estimate_min, scheduled_start, scheduled_end
       FROM tasks
      WHERE user_id = ? AND status != 'done' AND parent_task_id IS NULL
        AND due_date IS NOT NULL AND due_date <= ?
        AND (snoozed_until IS NULL OR snoozed_until <= ?)
      ORDER BY priority, due_time`
  )
    .bind(userId, date, date)
    .all<{
      id: string;
      title: string;
      priority: number;
      due_time: string | null;
      time_estimate_min: number | null;
      scheduled_start: string | null;
      scheduled_end: string | null;
    }>();

  // Timed calendar meetings today = busy.
  const { results: eventRows } = await env.DB.prepare(
    `SELECT start, end FROM calendar_events_cache
      WHERE user_id = ? AND NOT all_day AND start >= ? AND start < ?`
  )
    .bind(
      userId,
      date + "T00:00:00.000Z",
      nextDay + "T00:00:00.000Z"
    )
    .all<{ start: string; end: string }>();

  const busy: { startMs: number; endMs: number }[] = [];
  for (const e of eventRows) {
    const s = new Date(e.start).getTime();
    const en = new Date(e.end).getTime();
    if (!isNaN(s) && !isNaN(en)) busy.push({ startMs: s, endMs: en });
  }

  const schedulable: {
    id: string;
    title: string;
    priority: number;
    estimateMin: number;
    dueTime: string | null;
  }[] = [];
  for (const t of taskRows) {
    // Already time-blocked tasks stay put and just occupy the slot.
    if (t.scheduled_start && t.scheduled_end) {
      const s = new Date(t.scheduled_start).getTime();
      const en = new Date(t.scheduled_end).getTime();
      if (!isNaN(s) && !isNaN(en)) {
        busy.push({ startMs: s, endMs: en });
        continue;
      }
    }
    schedulable.push({
      id: t.id,
      title: t.title,
      priority: Number(t.priority),
      estimateMin: t.time_estimate_min ?? DEFAULT_ESTIMATE_MIN,
      dueTime: t.due_time,
    });
  }

  const res = scheduleBlocks(schedulable, busy, windowStartMs, dayEndMs);

  return {
    date,
    blocks: res.blocks.map((b) => ({
      task_id: b.task_id,
      title: b.title,
      priority: b.priority,
      start: new Date(b.startMs).toISOString(),
      end: new Date(b.endMs).toISOString(),
    })),
    unscheduled: res.unscheduled,
  };
}

// Compute + persist today's proposed plan (upsert on user+date). Skips overwriting
// a plan the user already accepted/dismissed today. Returns the stored plan id.
export async function generateDayPlan(
  env: Bindings,
  userId: string
): Promise<{ id: string; plan: GeneratedPlan } | null> {
  const plan = await computeDayPlan(env, userId);

  const existing = await env.DB.prepare(
    "SELECT id, status FROM day_plans WHERE user_id = ? AND date = ?"
  )
    .bind(userId, plan.date)
    .first<{ id: string; status: string }>();

  // Don't clobber a plan the user already acted on today.
  if (existing && existing.status !== "proposed") return null;

  const id = existing?.id ?? uuid();
  const blocksJson = JSON.stringify(plan.blocks);
  if (existing) {
    await env.DB.prepare(
      "UPDATE day_plans SET blocks = ?, status = 'proposed' WHERE id = ?"
    )
      .bind(blocksJson, id)
      .run();
  } else {
    await env.DB.prepare(
      "INSERT INTO day_plans (id, user_id, date, status, blocks) VALUES (?, ?, ?, 'proposed', ?)"
    )
      .bind(id, userId, plan.date, blocksJson)
      .run();
  }
  return { id, plan };
}

// Cron helper: draft today's plan for every user (best-effort, per-user isolated).
export async function generateDayPlansForAll(env: Bindings): Promise<void> {
  const { results } = await env.DB.prepare("SELECT id FROM users").all<{
    id: string;
  }>();
  for (const { id } of results) {
    await generateDayPlan(env, id).catch(console.error);
  }
}
