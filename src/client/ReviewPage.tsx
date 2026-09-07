import { safeFormat } from "./lib/safe-date";
import { parkedAgo } from "./lib/due";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { useReview, useAreas } from "./lib/queries";
import { StatsWidget } from "./components/StatsWidget";
import { areaColorVar } from "./lib/colors";
import { ReviewIcon, ICON_SIZE } from "./lib/icons";
import { dueLabel } from "./lib/due";
import { todayStr } from "./lib/utils";
import { Header } from "./components/PageHeader";

export function ReviewPage() {
  const { data, isLoading } = useReview();
  const { data: areas = [] } = useAreas();

  function fmtRange(from: string, to: string) {
    try {
      return `${safeFormat(from, "d MMM") ?? from} to ${safeFormat(to, "d MMM yyyy") ?? to}`;
    } catch {
      return `${from} to ${to}`;
    }
  }

  return (
    <div className="max-w-3xl pb-10">
      <Header title="Weekly review" icon={<ReviewIcon className={ICON_SIZE} />} />

      {isLoading || !data ? (
        <p className="px-2 text-sm text-subtle">Loading…</p>
      ) : (
        <div className="space-y-8">
          <p className="text-sm text-muted">{fmtRange(data.period.from, data.period.to)}</p>

          {/* Headline numbers. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ReviewStat value={data.stats.completed} label="Completed" tone="success" />
            <ReviewStat value={data.stats.slipped} label="Slipped" tone="danger" />
            <ReviewStat value={data.stats.upcoming} label="Next 7 days" tone="primary" />
            <ReviewStat value={data.stats.created} label="Created" tone="muted" />
          </div>

          {/* Parked. Deliberately NOT a headline number beside the four above:
              those are all "what happened this week" and this is a standing pile
              that has nothing to do with the week. It is here because the review
              is the one moment parked tasks can honestly be reconsidered, since
              no view will ever surface them on its own.

              The AGE is what makes it a prompt rather than a fact: "6 parked" is
              trivia, "6 parked, oldest 8 months ago" is a question. */}
          {!!data.stats.parked && (
            <ReviewCard title="Parked">
              <Link
                to="/parked"
                className="flex items-baseline gap-2 text-sm text-muted transition-colors hover:text-foreground"
              >
                <span className="text-lg font-semibold text-foreground">
                  {data.stats.parked}
                </span>
                <span>
                  set aside
                  {data.stats.parked_oldest
                    ? `, oldest ${parkedAgo(data.stats.parked_oldest, todayStr())}`
                    : ""}
                  . Still the right call?
                </span>
              </Link>
            </ReviewCard>
          )}

          <ReviewCard title="Progress">
            <StatsWidget />
          </ReviewCard>

          {data.by_area.length > 0 && (
            <ReviewCard title="Completed by area">
              <div className="space-y-3">
                {data.by_area.map((a) => {
                  const pct = Math.round(
                    (a.completed / Math.max(1, data.stats.completed)) * 100
                  );
                  const colour = areaColorVar(
                    areas.find((x) => x.name === a.area)?.color
                  );
                  return (
                    <div key={a.area}>
                      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: colour }}
                          />
                          <span className="truncate text-foreground">{a.area}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-muted">
                          {a.completed}
                          <span className="ml-1 text-subtle">({pct}%)</span>
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, background: colour }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </ReviewCard>
          )}

          <ReviewList
            title="Done this week"
            tasks={data.completed_tasks}
            empty="Nothing completed yet this week."
            tone="success"
          />
          <ReviewList
            title="Slipped"
            hint="Overdue and still open"
            tasks={data.slipped_tasks}
            empty="Nothing overdue. Nice."
            tone="danger"
          />
          <ReviewList
            title="Coming up"
            hint="Next 7 days"
            tasks={data.upcoming_tasks}
            empty="Nothing scheduled in the next week."
            tone="primary"
          />
        </div>
      )}
    </div>
  );
}

const REVIEW_TONE: Record<string, string> = {
  success: "var(--success)",
  danger: "var(--danger)",
  primary: "var(--primary)",
  muted: "var(--muted)",
};

function ReviewStat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "success" | "danger" | "primary" | "muted";
}) {
  return (
    <div className="rounded-xl border border-border bg-surface/60 p-4">
      <div
        className="text-3xl font-semibold tabular-nums leading-none"
        style={{ color: REVIEW_TONE[tone] }}
      >
        {value}
      </div>
      <div className="mt-2 text-xs text-muted">{label}</div>
    </div>
  );
}

// A titled card. Gives each block of the review a clear edge and its own space.
function ReviewCard({
  title,
  hint,
  count,
  children,
}: {
  title: string;
  hint?: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface/40">
      <header className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">
          {title}
          {hint && <span className="ml-2 text-xs font-normal text-subtle">{hint}</span>}
        </h2>
        {count != null && (
          <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs tabular-nums text-muted">
            {count}
          </span>
        )}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function ReviewList({
  title,
  hint,
  tasks,
  empty,
  tone,
}: {
  title: string;
  hint?: string;
  tasks: { id: string; title: string; due_date?: string | null }[];
  empty: string;
  tone: "success" | "danger" | "primary";
}) {
  return (
    <ReviewCard title={title} hint={hint} count={tasks.length}>
      {tasks.length === 0 ? (
        <p className="text-sm text-subtle">{empty}</p>
      ) : (
        // Read-only: the review summarises. These rows carry only a task ref, not
        // a full task, so there is nothing safe to open from here.
        <ul className="divide-y divide-border/60">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: REVIEW_TONE[tone] }}
              />
              <span className="min-w-0 flex-1 text-sm leading-snug text-foreground">
                {t.title}
              </span>
              {t.due_date && (
                <span
                  className="shrink-0 text-xs"
                  style={{ color: tone === "danger" ? "var(--danger)" : "var(--subtle)" }}
                  title={t.due_date}
                >
                  {dueLabel(t.due_date, todayStr())}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </ReviewCard>
  );
}
