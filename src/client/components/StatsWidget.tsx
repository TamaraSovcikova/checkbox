import { useStats } from "../lib/queries";
import { StreakIcon } from "../lib/icons";

// Progress panel: done-today / done-this-week, current + best streak, and a
// 12-week completion heatmap.
//
// This lives on the Weekly review, NOT on Today. On Today it was a distraction:
// a scoreboard sitting above the work. On the review it is the point, that is
// where you look back at momentum on purpose.
export function StatsWidget() {
  const { data } = useStats();
  if (!data) return null;

  const max = Math.max(1, ...data.heatmap.map((c) => c.count));
  // Break the flat day list into weeks (columns of 7), oldest-first.
  const weeks: { date: string; count: number }[][] = [];
  for (let i = 0; i < data.heatmap.length; i += 7) {
    weeks.push(data.heatmap.slice(i, i + 7));
  }

  return (
    <div className="rounded-xl border border-border bg-surface/40 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-5">
          <Stat value={data.done_today} label="today" />
          <Stat value={data.done_this_week} label="this week" />
          <div className="flex items-center gap-1.5">
            <StreakIcon
              className={
                data.streak_days > 0 ? "h-4 w-4 text-warning" : "h-4 w-4 text-subtle"
              }
            />
            <div className="leading-tight">
              <div className="text-sm font-semibold tabular-nums text-foreground">
                {data.streak_days}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-subtle">
                day streak
              </div>
            </div>
          </div>
        </div>
        {data.best_streak > 0 && (
          <span className="text-[11px] text-subtle">best {data.best_streak}d</span>
        )}
      </div>

      <div className="mt-3 flex gap-1 overflow-x-auto">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {week.map((cell) => (
              <div
                key={cell.date}
                title={`${cell.date}: ${cell.count} done`}
                className="h-2.5 w-2.5 rounded-sm"
                style={{
                  background:
                    cell.count === 0
                      ? "var(--surface-2)"
                      : `color-mix(in oklab, var(--success) ${Math.round(
                          25 + (cell.count / max) * 75
                        )}%, var(--surface-2))`,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="leading-tight">
      <div className="text-sm font-semibold tabular-nums text-foreground">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-subtle">{label}</div>
    </div>
  );
}
