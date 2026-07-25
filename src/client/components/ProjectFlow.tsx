// The Flow tab: the RUNWAY. Read-only answer to "what do I tackle first,
// and what after it", designed with Tamara over three mockup rounds (see
// the vault's DESIGN-project-flow.md).
//
// Far left: one green READY LINE, everything workable right now, overdue
// flagged inside it rather than moved. Rightward: blocked work receding at
// its dependency depth, dimmed so the eye stays on the green. Every
// dependency is a thin thread (position alone must never imply a link);
// the critical path is the one thick indigo spine. Hovering a card lights
// its own threads and fades the rest. Below: a scrollable ad-hoc shelf
// (unconnected but dated, teal, due+priority order) and a last quiet row
// of bare names (no due, no links, oldest first).
//
// The flow resets daily by construction: it renders open tasks plus tasks
// completed TODAY (struck through). A dependent unlocked by one of today's
// completions turns green IN PLACE ("unlocked today"); tomorrow the done
// card is gone from the query and the dependent wakes up in the ready line.

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Project, Task } from "../../shared/types";
import { runwayLayout, isOverdue } from "../../shared/flow";
import { useTasks } from "../lib/queries";
import { useTaskUI } from "../lib/ui-context";
import { dueLabel } from "../lib/due";
import { cn, todayStr } from "@/lib/utils";

const SLOT_W = 250;
const SLOT_GAP = 64;
const TEAL = "#14b8a6"; // the ad-hoc kind color, one literal for both themes

interface EdgeGeom {
  from: string;
  to: string;
  spine: boolean;
  d: string;
}

const gateNames = (t: Task) =>
  (t.depends_on ?? [])
    .filter((d) => d.status !== "done")
    .map((d) => (d.title.length > 26 ? d.title.slice(0, 25) + "…" : d.title))
    .join(" + ");

function Chips({ t, today, overdue }: { t: Task; today: string; overdue: boolean }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10.5px]">
      {overdue && (
        <span className="rounded border border-danger/50 px-1 font-bold text-danger">OVERDUE</span>
      )}
      {t.priority <= 2 && (
        <span
          className={cn(
            "rounded border px-1",
            t.priority === 1 ? "border-danger/40 text-danger" : "border-warning/40 text-warning"
          )}
        >
          P{t.priority}
        </span>
      )}
      {t.due_date && !overdue && (
        <span className="rounded border border-primary/40 px-1 text-primary/90">
          due {dueLabel(t.due_date, today)}
        </span>
      )}
      {t.due_date && overdue && (
        <span className="rounded border border-border px-1 text-subtle">
          was due {dueLabel(t.due_date, today)}
        </span>
      )}
      {t.time_estimate_min != null && (
        <span className="rounded border border-border px-1 text-subtle">
          {t.time_estimate_min < 60
            ? `${t.time_estimate_min}m`
            : t.time_estimate_min % 60 === 0
            ? `${t.time_estimate_min / 60}h`
            : `${Math.floor(t.time_estimate_min / 60)}h${t.time_estimate_min % 60}`}
        </span>
      )}
    </div>
  );
}

// Stable empties: an inline `= []` default mints a fresh array identity every
// render while the query loads, which re-memoizes the layout, re-fires the
// measuring effect, and loops React into error #185.
const NO_TASKS: Task[] = [];

export function ProjectFlow({ project }: { project: Project }) {
  const { open } = useTaskUI();
  const today = todayStr();
  const openTasks = useTasks({ project_id: project.id }).data ?? NO_TASKS;
  const doneTasks = useTasks({ project_id: project.id, status: "done" }).data ?? NO_TASKS;

  // The daily-reset boundary: yesterday's completions leave the flow.
  const doneToday = useMemo(
    () => doneTasks.filter((t) => (t.completed_at ?? "").slice(0, 10) === today),
    [doneTasks, today]
  );
  const layout = useMemo(
    () => runwayLayout([...openTasks, ...doneToday]),
    [openTasks, doneToday]
  );

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const [edges, setEdges] = useState<EdgeGeom[]>([]);
  const [focus, setFocus] = useState<string | null>(null);

  // Threads are measured off the real DOM (cards autosize to their full
  // titles), then redrawn on data change and window resize. Only sets state
  // when the geometry actually changed, so a re-measure can never loop.
  const lastGeom = useRef("");
  useLayoutEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current;
      const out: EdgeGeom[] = [];
      if (wrap) {
        const wr = wrap.getBoundingClientRect();
        for (const e of layout.edges) {
          const a = cardRefs.current.get(e.from)?.getBoundingClientRect();
          const b = cardRefs.current.get(e.to)?.getBoundingClientRect();
          if (!a || !b) continue;
          const x1 = a.right - wr.left;
          const y1 = a.top + a.height / 2 - wr.top;
          const x2 = b.left - wr.left;
          const y2 = b.top + b.height / 2 - wr.top;
          const mx = (x1 + x2) / 2;
          out.push({
            from: e.from,
            to: e.to,
            spine: e.spine,
            d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
          });
        }
      }
      const key = out.map((e) => `${e.from}>${e.to}:${e.d}`).join("|");
      if (key !== lastGeom.current) {
        lastGeom.current = key;
        setEdges(out);
      }
    };
    measure();
    // Fonts settling can shift card heights just after first paint.
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, [layout]);

  const tasksCount = openTasks.length + doneToday.length;
  if (tasksCount === 0) {
    return <p className="mt-6 text-sm text-subtle">No tasks in this project yet.</p>;
  }

  const hasFlow = layout.slots.length > 0;
  const focusTouches = (e: EdgeGeom) => focus != null && (e.from === focus || e.to === focus);

  const card = (t: Task, kind: "flow" | "adhoc") => {
    const done = t.status === "done";
    const ready = layout.ready.has(t.id);
    const unlocked = layout.unlockedToday.has(t.id);
    const late = isOverdue(t, today);
    const gates = !done && !ready ? gateNames(t) : "";
    return (
      <div
        key={t.id}
        ref={(el) => {
          if (el) cardRefs.current.set(t.id, el);
          else cardRefs.current.delete(t.id);
        }}
        onClick={() => open(t)}
        onMouseEnter={() => setFocus(t.id)}
        onMouseLeave={() => setFocus((f) => (f === t.id ? null : f))}
        role="button"
        aria-label={t.title}
        className={cn(
          "relative cursor-pointer rounded-[10px] border bg-surface px-3 py-2.5 text-[12.5px] transition-opacity",
          kind === "adhoc"
            ? "w-60 shrink-0 border-dashed"
            : "border-border",
          done && "opacity-55",
          !done && kind === "flow" && ready && "border-success shadow-[0_0_0_1px_var(--success),0_0_14px_rgba(52,211,153,0.18)]",
          !done && kind === "flow" && !ready && "opacity-50 hover:opacity-90"
        )}
        style={kind === "adhoc" ? { borderColor: TEAL } : undefined}
      >
        {(ready || done) && kind === "flow" && (
          <div
            className={cn("mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold")}
            style={{ color: "var(--success, #34d399)" }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: "currentColor", boxShadow: "0 0 5px currentColor" }}
            />
            {done ? "done today ✓" : unlocked ? "ready · unlocked today" : "ready"}
          </div>
        )}
        {kind === "adhoc" && (
          <div className="mb-1 text-[10.5px] font-semibold" style={{ color: TEAL }}>
            anytime
          </div>
        )}
        <div className={cn("font-semibold leading-[1.35]", done && "line-through")}>
          {t.title}
        </div>
        <Chips t={t} today={today} overdue={late} />
        {gates && (
          <span className="mt-1 block text-[10.5px] text-subtle">
            after: <span className="text-muted">{gates}</span>
          </span>
        )}
        {layout.cyclic.has(t.id) && (
          <span className="mt-1 block text-[10px] font-semibold text-warning">
            dependency cycle
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="mt-4 space-y-3">
      {hasFlow ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface/30 p-5">
          <div ref={wrapRef} className="relative w-max min-w-full">
            <svg className="pointer-events-none absolute inset-0 h-full w-full">
              {edges
                .slice()
                .sort((a, b) => Number(a.spine) - Number(b.spine))
                .map((e) => (
                  <path
                    key={`${e.from}>${e.to}`}
                    d={e.d}
                    fill="none"
                    stroke={e.spine ? "var(--primary)" : "var(--input)"}
                    strokeWidth={e.spine ? 4.5 : 1.6}
                    strokeLinecap="round"
                    strokeOpacity={
                      focus == null ? (e.spine ? 0.85 : 0.8) : focusTouches(e) ? 1 : 0.12
                    }
                    filter={e.spine ? "drop-shadow(0 0 4px rgba(99,102,241,0.45))" : undefined}
                  />
                ))}
            </svg>
            <div className="relative flex items-start" style={{ gap: SLOT_GAP }}>
              {layout.slots.map((bucket, depth) => (
                <div
                  key={depth}
                  className="flex shrink-0 flex-col gap-3.5"
                  style={{ width: SLOT_W }}
                >
                  {depth === 0 && (
                    <div
                      className="text-[10px] font-bold tracking-[0.1em]"
                      style={{ color: "var(--success, #34d399)" }}
                    >
                      ● WORK ON NOW
                    </div>
                  )}
                  {bucket.map((t) => card(t, "flow"))}
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-subtle">
              <span>
                <span
                  className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[3px] border"
                  style={{ borderColor: "var(--success, #34d399)" }}
                />
                green = work on it now (overdue is a flag, not a place)
              </span>
              <span className="opacity-80">dimmed = waiting · says after what</span>
              <span>
                <span className="mr-1.5 inline-block h-[5px] w-6 rounded bg-primary align-middle" />
                spine
              </span>
              <span>crossed out = completed today, gone tomorrow</span>
            </div>
          </div>
        </div>
      ) : (
        (layout.adhoc.length > 0 || layout.names.length > 0) && (
          <p className="text-xs text-subtle">
            No dependencies recorded yet. Link tasks with "Blocked by" in the
            task sheet and the flow takes shape.
          </p>
        )
      )}

      {layout.adhoc.length > 0 && (
        <div className="rounded-xl border border-border bg-surface/30 p-3">
          <div className="mb-2 text-[10px] font-bold tracking-[0.1em] text-subtle">
            AD-HOC · NOT LINKED TO THE FLOW · SORTED BY DUE, THEN PRIORITY
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1.5">
            {layout.adhoc.map((t) => card(t, "adhoc"))}
          </div>
        </div>
      )}

      {layout.names.length > 0 && (
        <div className="rounded-xl border border-border bg-surface/30 p-3">
          <div className="mb-1 text-[10px] font-bold tracking-[0.1em] text-subtle">
            JUST NAMES · NO DATE, NO LINKS · OLDEST FIRST
          </div>
          <div>
            {layout.names.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => open(t)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-muted transition-colors hover:bg-surface"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full border border-dashed"
                  style={{ borderColor: "var(--subtle, #64748b)" }}
                />
                <span className="min-w-0 flex-1">{t.title}</span>
                {t.created_at && (
                  <span className="shrink-0 text-[10.5px] text-subtle">
                    added {dueLabel(t.created_at.slice(0, 10), today)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
