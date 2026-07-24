// The Flow tab: a project's dependency graph drawn as a metro map. Read-only
// by design; the one interaction is clicking a station to peek at the task in
// the sheet. Layout comes from shared/flow (layering, frontier, critical path,
// cycle parking); this file only places and paints it.
//
// Chosen over step-columns and cascade-bands on a live mockup board (see the
// vault's DESIGN-project-flow.md): the critical path draws as the thick indigo
// trunk line, side chains as muted colored branches merging where they
// unblock, tasks as stations (filled = done, glowing ring = ready now,
// hollow = waiting), and a faint date rail zones the canvas.

import { useMemo } from "react";
import type { Project, Task } from "../../shared/types";
import { flowLayout, dateRail } from "../../shared/flow";
import { useTasks } from "../lib/queries";
import { useTaskUI } from "../lib/ui-context";
import { dueLabel } from "../lib/due";
import { todayStr } from "@/lib/utils";

const STEP_W = 250; // horizontal room per dependency step
const LANE_H = 92; // vertical room per lane (station + two label lines)
const X0 = 130; // first station's x, leaves room for step-0 labels
const RAIL_H = 34; // date rail strip at the top
const LEGEND_H = 40;

// Branch colors by how far a lane sits from the trunk. Muted enough to stay
// quiet on both themes; the trunk itself always draws in the app primary.
const LANE_COLORS = ["#64748b", "#2dd4bf", "#d97706", "#38bdf8", "#fb7185"];

const fmtEstimate = (min: number) =>
  min < 60 ? `${min}m` : min % 60 === 0 ? `${min / 60}h` : `${Math.floor(min / 60)}h${min % 60}`;

const truncate = (s: string, n = 26) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

interface StationPos {
  task: Task;
  x: number;
  y: number;
  lane: number;
  color: string; // the line color this station belongs to
}

export function ProjectFlow({ project }: { project: Project }) {
  const { open } = useTaskUI();
  const today = todayStr();
  // Open AND done: the map shows the walked part of the spine too. Done rows
  // are hidden by the list endpoint's default, so they ride a second query.
  const { data: openTasks = [] } = useTasks({ project_id: project.id });
  const { data: doneTasks = [] } = useTasks({ project_id: project.id, status: "done" });

  const { layout, stations, zones, width, height, structured } = useMemo(() => {
    const tasks = [...openTasks, ...doneTasks];
    const layout = flowLayout(tasks);
    // A project with no recorded dependencies has no meaningful frontier
    // (every open task is "ready") and no spine. Glow and trunk paint only
    // exist once the map has structure, or the scarce signal drowns in itself.
    const structured = layout.edges.length > 0;

    // Lanes: the critical task of a step holds the trunk lane (0); the rest
    // fan out alternating above and below, nearest-first, so a step reads
    // outward from the spine.
    const stations = new Map<string, StationPos>();
    let minLane = 0;
    let maxLane = 0;
    layout.steps.forEach((bucket, step) => {
      const trunk = bucket.filter((t) => layout.critical.has(t.id));
      const rest = bucket.filter((t) => !layout.critical.has(t.id));
      const lanes: [Task, number][] = trunk.map((t) => [t, 0]);
      let i = 0;
      for (const t of rest) {
        // -1, +1, -2, +2, ... shifted to 0, -1, +1, ... when no trunk here.
        const k = trunk.length > 0 ? i : i - 1;
        const lane =
          k < 0 ? 0 : k % 2 === 0 ? -(Math.floor(k / 2) + 1) : Math.floor(k / 2) + 1;
        lanes.push([t, lane]);
        i++;
      }
      for (const [t, lane] of lanes) {
        minLane = Math.min(minLane, lane);
        maxLane = Math.max(maxLane, lane);
        stations.set(t.id, {
          task: t,
          x: X0 + step * STEP_W,
          y: 0, // filled below once lane extent is known
          lane,
          color:
            structured && layout.critical.has(t.id)
              ? "var(--primary)"
              : LANE_COLORS[Math.min(Math.abs(lane), LANE_COLORS.length - 1)],
        });
      }
    });
    const yCenter = RAIL_H + 26 + -minLane * LANE_H + LANE_H / 2;
    for (const s of stations.values()) s.y = yCenter + s.lane * LANE_H;

    const width = Math.max(720, X0 + (layout.steps.length - 1) * STEP_W + 150);
    const height = RAIL_H + 26 + (maxLane - minLane + 1) * LANE_H + LEGEND_H;
    const zones = dateRail(layout.steps, today);
    return { layout, stations, zones, width, height, structured };
  }, [openTasks, doneTasks, today]);

  const tasksCount = openTasks.length + doneTasks.length;
  if (tasksCount === 0) {
    return <p className="mt-6 text-sm text-subtle">No tasks in this project yet.</p>;
  }

  // Metro-style connector: straight when the lanes agree, an S-curve when the
  // line changes lanes to merge.
  const edgePath = (a: StationPos, b: StationPos) => {
    if (a.y === b.y) return `M ${a.x} ${a.y} H ${b.x}`;
    const mx = (a.x + b.x) / 2;
    return `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
  };

  // Sub-line under (or over) a station: the why-it-matters in six words.
  const subFor = (t: Task) => {
    if (t.status === "done") return { text: "done", fill: "#64748b" };
    const bits: string[] = [];
    if (t.priority <= 2) bits.push(`P${t.priority}`);
    if (t.due_date) bits.push(`due ${dueLabel(t.due_date, today)}`);
    if (structured && layout.frontier.has(t.id)) {
      if (t.time_estimate_min) bits.push(fmtEstimate(t.time_estimate_min));
      return {
        text: bits.join(" · ") || "ready now",
        fill: t.priority === 1 ? "var(--danger, #f87171)" : t.priority === 2 ? "#d97706" : "#818cf8",
      };
    }
    const waits = (t.depends_on ?? []).filter((d) => d.status !== "done").length;
    if (waits > 0) bits.push(`waits on ${waits}`);
    return { text: bits.join(" · "), fill: "#64748b" };
  };

  return (
    <div className="mt-4">
      {layout.edges.length === 0 && tasksCount > 1 && (
        <p className="mb-3 text-xs text-subtle">
          No dependencies recorded yet, so every task is step 1. Link tasks with
          "Blocked by" in the task sheet and the map takes shape.
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface/30">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Dependency map of ${project.name}`}
          className="block"
        >
          {/* ── Date rail ─────────────────────────────────────────────── */}
          {zones.length > 0 && (
            <g>
              <line x1={0} y1={RAIL_H} x2={width} y2={RAIL_H} stroke="var(--border)" strokeOpacity={0.6} />
              {zones.map((z, i) => {
                const zx = X0 + z.fromStep * STEP_W - STEP_W / 2;
                return (
                  <g key={z.label + z.fromStep}>
                    {i > 0 && (
                      <line x1={zx} y1={RAIL_H} x2={zx} y2={height - LEGEND_H} stroke="var(--border)" strokeOpacity={0.5} strokeDasharray="3 6" />
                    )}
                    <text x={Math.max(zx + 14, 14)} y={22} fontSize={10} fontWeight={600} letterSpacing="0.08em" fill="#64748b" opacity={0.8}>
                      {z.label.toUpperCase()}
                    </text>
                  </g>
                );
              })}
            </g>
          )}

          {/* ── Lines (branches under, trunk on top) ──────────────────── */}
          {layout.edges
            .slice()
            .sort((a, b) => Number(a.critical) - Number(b.critical))
            .map((e) => {
              const a = stations.get(e.from);
              const b = stations.get(e.to);
              if (!a || !b) return null;
              return (
                <path
                  key={`${e.from}>${e.to}`}
                  d={edgePath(a, b)}
                  fill="none"
                  stroke={e.critical ? "var(--primary)" : a.color}
                  strokeWidth={e.critical ? 6 : 3.5}
                  strokeOpacity={e.critical ? 0.9 : 0.4}
                  strokeLinecap="round"
                />
              );
            })}

          {/* ── Stations ──────────────────────────────────────────────── */}
          {[...stations.values()].map((s) => {
            const t = s.task;
            const done = t.status === "done";
            const ready = structured && layout.frontier.has(t.id);
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
                  fill={done ? s.color : "var(--surface)"}
                  stroke={
                    layout.cyclic.has(t.id)
                      ? "#d97706"
                      : done
                      ? s.color
                      : ready
                      ? "var(--primary)"
                      : "#475569"
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
                  fill={done ? "#64748b" : "var(--foreground)"}
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
          })}

          {/* ── Legend ────────────────────────────────────────────────── */}
          <g fontSize={10} fill="#64748b" transform={`translate(16, ${height - 16})`}>
            <circle cx={4} cy={-3} r={5} fill="var(--primary)" />
            <text x={14} y={0}>done</text>
            <circle cx={58} cy={-3} r={5} fill="var(--surface)" stroke="var(--primary)" strokeWidth={2.5} />
            <text x={68} y={0}>ready now</text>
            <circle cx={132} cy={-3} r={5} fill="var(--surface)" stroke="#475569" strokeWidth={2} />
            <text x={142} y={0}>waiting</text>
            {structured && (
              <text x={196} y={0} opacity={0.8}>— thick indigo line = critical path</text>
            )}
          </g>

        </svg>
      </div>
    </div>
  );
}
