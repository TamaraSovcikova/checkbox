// The Flow tab: a project's dependency graph drawn as a metro map. Read-only
// by design; the one interaction is clicking a station (or a pool pill) to
// peek at the task in the sheet. Layout comes from shared/flow; this file
// only places and paints it.
//
// v2 after the first real project: line-first. Each line from the layout owns
// one horizontal band, drawn as a single straight run; only merge edges
// curve. Tasks with no dependency edges never enter the canvas; they list in
// a quiet "Not on a line yet" strip below, because unconnected stations
// scattered between the tracks are what made v1 unreadable. Dates annotate
// columns as small "by <date>" chips; v1's timeline-shaped rail lied the
// moment due dates stopped correlating with dependency depth.

import { useMemo } from "react";
import type { Project, Task } from "../../shared/types";
import { flowLayout, stepDues } from "../../shared/flow";
import { useTasks } from "../lib/queries";
import { useTaskUI } from "../lib/ui-context";
import { dueLabel } from "../lib/due";
import { todayStr } from "@/lib/utils";

const STEP_W = 250; // horizontal room per dependency step
const LANE_H = 96; // vertical room per lane (station + two label lines)
const X0 = 130; // first station's x, leaves room for step-0 labels
const TOP_PAD = 36; // "by <date>" chip row
const LEGEND_H = 40;

// Branch line colors, cycled by line. The trunk always draws in the app
// primary. Muted enough to stay quiet on both themes.
const LINE_COLORS = ["#2dd4bf", "#d97706", "#38bdf8", "#fb7185", "#a78bfa", "#64748b"];

const fmtEstimate = (min: number) =>
  min < 60 ? `${min}m` : min % 60 === 0 ? `${min / 60}h` : `${Math.floor(min / 60)}h${min % 60}`;

const truncate = (s: string, n = 26) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function ProjectFlow({ project }: { project: Project }) {
  const { open } = useTaskUI();
  const today = todayStr();
  // Open AND done: the map shows the walked part of the spine too. Done rows
  // are hidden by the list endpoint's default, so they ride a second query.
  const { data: openTasks = [] } = useTasks({ project_id: project.id });
  const { data: doneTasks = [] } = useTasks({ project_id: project.id, status: "done" });

  const { layout, pos, lineColor, dues, width, height } = useMemo(() => {
    const layout = flowLayout([...openTasks, ...doneTasks]);

    const lanes = layout.lines.map((l) => l.lane);
    const minLane = Math.min(0, ...lanes);
    const maxLane = Math.max(0, ...lanes);
    const y = (lane: number) => TOP_PAD + (lane - minLane) * LANE_H + LANE_H / 2;
    const x = (step: number) => X0 + step * STEP_W;

    const pos = new Map<string, { x: number; y: number; lane: number }>();
    for (const line of layout.lines) {
      for (const id of line.ids) {
        const step = layout.stepOf.get(id)!;
        pos.set(id, { x: x(step), y: y(line.lane), lane: line.lane });
      }
    }
    const lineColor = (lineIndex: number) => {
      const line = layout.lines[lineIndex];
      return line.color === -1
        ? "var(--primary)"
        : LINE_COLORS[line.color % LINE_COLORS.length];
    };

    const dues = stepDues(layout.steps);
    const width = Math.max(720, X0 + Math.max(0, layout.steps.length - 1) * STEP_W + 150);
    const height = TOP_PAD + (maxLane - minLane + 1) * LANE_H + LEGEND_H;
    return { layout, pos, lineColor, dues, width, height };
  }, [openTasks, doneTasks]);

  const tasksCount = openTasks.length + doneTasks.length;
  if (tasksCount === 0) {
    return <p className="mt-6 text-sm text-subtle">No tasks in this project yet.</p>;
  }

  const hasMap = layout.lines.length > 0;

  // A line's own body is one straight run; only cross-line edges curve.
  const lineEdgeKeys = new Set<string>();
  for (const line of layout.lines) {
    for (let i = 1; i < line.ids.length; i++) {
      lineEdgeKeys.add(`${line.ids[i - 1]}>${line.ids[i]}`);
    }
  }
  const crossEdges = layout.edges.filter((e) => !lineEdgeKeys.has(`${e.from}>${e.to}`));
  const taskById = new Map(layout.steps.flat().map((t) => [t.id, t]));

  // A merge or fork carries the color of its non-trunk participant, so a
  // branch visibly flows into (or out of) the trunk in its own color.
  const crossColor = (e: { from: string; to: string }) => {
    const fromLine = layout.lineOf.get(e.from)!;
    const toLine = layout.lineOf.get(e.to)!;
    if (layout.lines[toLine].color === -1) return lineColor(fromLine);
    if (layout.lines[fromLine].color === -1) return lineColor(toLine);
    return lineColor(fromLine);
  };

  // Sub-line under (or over) a station: the why-it-matters in six words.
  const subFor = (t: Task) => {
    if (t.status === "done") return { text: "done", fill: "var(--subtle)" };
    const bits: string[] = [];
    if (t.priority <= 2) bits.push(`P${t.priority}`);
    if (t.due_date) bits.push(`due ${dueLabel(t.due_date, today)}`);
    if (layout.frontier.has(t.id)) {
      if (t.time_estimate_min) bits.push(fmtEstimate(t.time_estimate_min));
      return {
        text: bits.join(" · ") || "ready now",
        fill: t.priority === 1 ? "var(--danger, #f87171)" : t.priority === 2 ? "#d97706" : "var(--primary)",
      };
    }
    const waits = (t.depends_on ?? []).filter((d) => d.status !== "done").length;
    if (waits > 0) bits.push(`waits on ${waits}`);
    return { text: bits.join(" · "), fill: "var(--subtle)" };
  };

  return (
    <div className="mt-4 space-y-3">
      {hasMap ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface/30">
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`Dependency map of ${project.name}`}
            className="block"
          >
            {/* ── "by <date>" chips over the columns ─────────────────────── */}
            {dues.map((d, step) =>
              d ? (
                <text
                  key={step}
                  x={X0 + step * STEP_W}
                  y={20}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={600}
                  letterSpacing="0.06em"
                  fill="var(--subtle)"
                  opacity={0.85}
                >
                  BY {dueLabel(d, today).toUpperCase()}
                </text>
              ) : null
            )}

            {/* ── Line bodies (branches under, trunk on top) ─────────────── */}
            {layout.lines
              .slice()
              .sort((a, b) => Number(a.color === -1) - Number(b.color === -1))
              .map((line, idx) => {
                if (line.ids.length < 2) return null;
                const a = pos.get(line.ids[0])!;
                const b = pos.get(line.ids[line.ids.length - 1])!;
                const trunk = line.color === -1;
                const d = `M ${a.x} ${a.y} H ${b.x}`;
                return (
                  <g key={`line-${idx}-${line.ids[0]}`}>
                    {/* Soft underlay keeps the trunk the visually heaviest
                        line in ANY palette; in a monochrome one (graphite)
                        the colored branches would otherwise out-shout a
                        neutral trunk. */}
                    {trunk && (
                      <path d={d} fill="none" stroke="var(--primary)" strokeWidth={12} strokeOpacity={0.15} strokeLinecap="round" />
                    )}
                    <path
                      d={d}
                      fill="none"
                      stroke={trunk ? "var(--primary)" : LINE_COLORS[line.color % LINE_COLORS.length]}
                      strokeWidth={trunk ? 6 : 3.5}
                      strokeOpacity={trunk ? 0.9 : 0.65}
                      strokeLinecap="round"
                    />
                  </g>
                );
              })}

            {/* ── Merge and fork curves ──────────────────────────────────── */}
            {crossEdges.map((e) => {
              const a = pos.get(e.from);
              const b = pos.get(e.to);
              if (!a || !b) return null;
              const mx = (a.x + b.x) / 2;
              return (
                <path
                  key={`${e.from}>${e.to}`}
                  d={
                    a.y === b.y
                      ? `M ${a.x} ${a.y} H ${b.x}`
                      : `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`
                  }
                  fill="none"
                  stroke={crossColor(e)}
                  strokeWidth={3}
                  strokeOpacity={0.5}
                  strokeLinecap="round"
                />
              );
            })}

            {/* ── Stations ───────────────────────────────────────────────── */}
            {layout.lines.flatMap((line, lineIdx) =>
              line.ids.map((id) => {
                const s = pos.get(id)!;
                const t = taskById.get(id)!;
                const color = lineColor(lineIdx);
                const done = t.status === "done";
                const ready = layout.frontier.has(t.id);
                const above = s.lane <= 0;
                const sub = subFor(t);
                const titleY = above ? s.y - 24 : s.y + 30;
                const subY = above ? s.y - 40 : s.y + 46;
                return (
                  <g
                    key={t.id}
                    onClick={() => open(t)}
                    className="cursor-pointer"
                    role="button"
                    aria-label={t.title}
                  >
                    <title>{t.title}</title>
                    {ready && (
                      <circle cx={s.x} cy={s.y} r={15} fill="none" stroke="var(--primary)" strokeOpacity={0.3} strokeWidth={5} />
                    )}
                    <circle
                      cx={s.x}
                      cy={s.y}
                      r={9}
                      fill={done ? color : "var(--surface)"}
                      stroke={
                        layout.cyclic.has(t.id)
                          ? "#d97706"
                          : done
                          ? color
                          : ready
                          ? "var(--primary)"
                          : "var(--subtle)"
                      }
                      strokeWidth={ready ? 3 : 2.5}
                    />
                    {done && (
                      <text x={s.x} y={s.y + 3.5} textAnchor="middle" fontSize={10} fill="#fff">
                        ✓
                      </text>
                    )}
                    <text
                      x={s.x}
                      y={titleY}
                      textAnchor="middle"
                      fontSize={12}
                      fontWeight={done ? 400 : 600}
                      fill={done ? "var(--subtle)" : "var(--foreground)"}
                      opacity={done ? 0.7 : 1}
                    >
                      {truncate(t.title)}
                    </text>
                    {sub.text && (
                      <text x={s.x} y={subY} textAnchor="middle" fontSize={10} fill={sub.fill}>
                        {sub.text}
                      </text>
                    )}
                    {layout.cyclic.has(t.id) && (
                      <text x={s.x} y={s.y + (above ? 20 : -14)} textAnchor="middle" fontSize={9} fill="#d97706">
                        cycle
                      </text>
                    )}
                  </g>
                );
              })
            )}

            {/* ── Legend ─────────────────────────────────────────────────── */}
            <g fontSize={10} fill="var(--subtle)" transform={`translate(16, ${height - 16})`}>
              <circle cx={4} cy={-3} r={5} fill="var(--primary)" />
              <text x={14} y={0}>done</text>
              <circle cx={58} cy={-3} r={5} fill="var(--surface)" stroke="var(--primary)" strokeWidth={2.5} />
              <text x={68} y={0}>ready now</text>
              <circle cx={132} cy={-3} r={5} fill="var(--surface)" stroke="var(--subtle)" strokeWidth={2} />
              <text x={142} y={0}>waiting</text>
              <path d="M 196 -3 H 226" stroke="var(--primary)" strokeWidth={5} strokeLinecap="round" />
              <text x={234} y={0} opacity={0.8}>critical path</text>
            </g>
          </svg>
        </div>
      ) : (
        <p className="text-xs text-subtle">
          No dependencies recorded yet. Link tasks with "Blocked by" in the task
          sheet and the map takes shape.
        </p>
      )}

      {/* ── The pool: real tasks, just not sequenced ───────────────────────── */}
      {layout.loose.length > 0 && (
        <div className="rounded-xl border border-border bg-surface/30 p-3">
          <div className="mb-2 text-xs font-medium text-subtle">
            Not on a line yet · {layout.loose.length}
          </div>
          <div className="flex flex-wrap gap-2">
            {layout.loose.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => open(t)}
                className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-surface-2"
                title={t.title}
              >
                {truncate(t.title, 44)}
                {(t.due_date || t.priority <= 2) && (
                  <span className="ml-1.5 text-[10px] text-subtle">
                    {[
                      t.priority <= 2 ? `P${t.priority}` : null,
                      t.due_date ? dueLabel(t.due_date, today) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
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
