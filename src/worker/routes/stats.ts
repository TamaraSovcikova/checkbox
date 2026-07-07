import { Hono } from "hono";
import { type Bindings, getUserId } from "../db";

export const stats = new Hono<{ Bindings: Bindings }>();

function todayStr(tz = "Europe/Brussels") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysStr(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Progress + streaks. Completions are bucketed by the Brussels calendar day of
// completed_at (substr of the stored UTC ISO — good enough for a personal app in
// a positive-offset tz; midnight-edge completions may land a day off).
stats.get("/", async (c) => {
  const userId = await getUserId(c);
  const today = todayStr();
  const HEATMAP_DAYS = 84; // ~12 weeks
  const since = addDaysStr(today, -(HEATMAP_DAYS - 1));

  const { results } = await c.env.DB.prepare(
    `SELECT substr(completed_at, 1, 10) AS day, COUNT(*) AS cnt
       FROM tasks
      WHERE user_id = ? AND status = 'done' AND completed_at IS NOT NULL
        AND substr(completed_at, 1, 10) >= ?
      GROUP BY day`
  )
    .bind(userId, since)
    .all<{ day: string; cnt: number }>();

  const counts = new Map<string, number>();
  for (const r of results) counts.set(r.day, Number(r.cnt));

  // Dense heatmap: one cell per day, oldest first.
  const heatmap: { date: string; count: number }[] = [];
  for (let i = HEATMAP_DAYS - 1; i >= 0; i--) {
    const day = addDaysStr(today, -i);
    heatmap.push({ date: day, count: counts.get(day) ?? 0 });
  }

  const weekAgo = addDaysStr(today, -6);
  let doneThisWeek = 0;
  for (const [day, cnt] of counts) if (day >= weekAgo) doneThisWeek += cnt;

  // Current streak: consecutive days with >=1 completion, ending today or (if
  // nothing done yet today) yesterday, so an in-progress day doesn't break it.
  let streak = 0;
  let cursor = counts.has(today) ? today : addDaysStr(today, -1);
  while (counts.has(cursor)) {
    streak++;
    cursor = addDaysStr(cursor, -1);
  }

  // Best streak over the heatmap window.
  let best = 0;
  let run = 0;
  for (const cell of heatmap) {
    if (cell.count > 0) {
      run++;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }

  return c.json({
    done_today: counts.get(today) ?? 0,
    done_this_week: doneThisWeek,
    streak_days: streak,
    best_streak: best,
    heatmap,
  });
});
