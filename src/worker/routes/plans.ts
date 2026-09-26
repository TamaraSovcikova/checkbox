import { Hono } from "hono";
import { type Bindings, getUserId, now } from "../db";
import { computeDayPlan, generateDayPlan } from "../lib/planner";
import { pushTaskToGcal } from "../lib/sync";
import type { DayPlanBlock } from "../../shared/types";
import { todayFor } from "../lib/tz";

export const plans = new Hono<{ Bindings: Bindings }>();


function rowToPlan(r: Record<string, unknown>) {
  return {
    id: r.id,
    date: r.date,
    status: r.status,
    blocks: JSON.parse((r.blocks as string) || "[]"),
    created_at: r.created_at,
  };
}

// Today's proposed plan, if one exists. Returns null when there's nothing drafted.
plans.get("/today", async (c) => {
  const userId = await getUserId(c);
  const row = await c.env.DB.prepare(
    "SELECT * FROM day_plans WHERE user_id = ? AND date = ?"
  )
    .bind(userId, (await todayFor(c.env.DB, userId)))
    .first<Record<string, unknown>>();
  return c.json(row ? rowToPlan(row) : null);
});

// Draft (or redraft) today's plan on demand.
plans.post("/generate", async (c) => {
  const userId = await getUserId(c);
  const res = await generateDayPlan(c.env, userId);
  if (!res) {
    // A plan already accepted/dismissed today: return the fresh computation so
    // the caller can preview it without overwriting the acted-on record.
    const preview = await computeDayPlan(c.env, userId);
    return c.json({ id: null, ...preview, status: "preview" });
  }
  return c.json({ id: res.id, ...res.plan, status: "proposed" });
});

// Accept a proposed plan: write each block's scheduled_start/end (which pushes to
// GCal) and mark the plan accepted.
plans.post("/:id/accept", async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT blocks FROM day_plans WHERE id = ? AND user_id = ?"
  )
    .bind(id, userId)
    .first<{ blocks: string }>();
  if (!row) return c.json({ error: "not found" }, 404);

  const blocks = JSON.parse(row.blocks || "[]") as DayPlanBlock[];
  const stmts = blocks.map((b) =>
    c.env.DB.prepare(
      "UPDATE tasks SET scheduled_start = ?, scheduled_end = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    ).bind(b.start, b.end, now(), b.task_id, userId)
  );
  if (stmts.length) await c.env.DB.batch(stmts);

  await c.env.DB.prepare(
    "UPDATE day_plans SET status = 'accepted' WHERE id = ? AND user_id = ?"
  )
    .bind(id, userId)
    .run();

  // Best-effort GCal push for each scheduled task.
  for (const b of blocks) {
    c.executionCtx?.waitUntil(
      pushTaskToGcal(c.env, b.task_id, userId).catch(console.error)
    );
  }
  return c.json({ ok: true, scheduled: blocks.length });
});

plans.post("/:id/dismiss", async (c) => {
  const userId = await getUserId(c);
  await c.env.DB.prepare(
    "UPDATE day_plans SET status = 'dismissed' WHERE id = ? AND user_id = ?"
  )
    .bind(c.req.param("id"), userId)
    .run();
  return c.json({ ok: true });
});
