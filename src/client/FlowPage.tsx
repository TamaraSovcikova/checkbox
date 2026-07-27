// The Flow page: one project's runway at a time, with prev/next arrows and a
// jump-to-project dropdown. It began as every runway stacked behind a chip
// wall; with 20+ active projects that was a filter maze, and she asked for a
// navigator instead. One at a time also means the FULL runway renders here
// (shelves, names row, legend), identical to the project tab.
//
// The arrow keys page between projects. The selection persists per device
// (viewDefaults["/flow"].flowProject), so the page reopens where you left it.

import { useEffect, useMemo } from "react";
import { Header } from "./components/PageHeader";
import { ProjectFlow } from "./components/ProjectFlow";
import { useAreas, useProjects, useTasks, useViewPrefs } from "./lib/queries";
import { readyCountsByProject } from "../shared/flow";
import {
  FlowIcon,
  ICON_SIZE,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "./lib/icons";
import { areaColorVar } from "./lib/colors";

export default function FlowPage() {
  const { data: projects = [] } = useProjects();
  const { data: areas = [] } = useAreas();
  const { hide, viewDefault, setViewDefault } = useViewPrefs();
  // One flat open-task query feeds the ready counts in the dropdown; the
  // runway's own per-project queries share the cache with the project tabs.
  const allOpen = useTasks({}).data;
  const readyCounts = useMemo(
    () => readyCountsByProject(allOpen ?? []),
    [allOpen]
  );

  const active = projects.filter((p) => p.status === "active");
  const stored = viewDefault("/flow").flowProject;
  const current =
    active.find((p) => p.id === stored) ?? (active.length ? active[0] : null);
  const idx = current ? active.findIndex((p) => p.id === current.id) : -1;

  const go = (delta: number) => {
    if (active.length === 0) return;
    const next = active[(idx + delta + active.length) % active.length];
    setViewDefault("/flow", { flowProject: next.id });
  };

  // Arrow keys page between projects, unless focus is in a field or a select
  // (typing and dropdown navigation must win).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (el?.isContentEditable) return;
      e.preventDefault();
      go(e.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const area = current ? areas.find((a) => a.id === current.area_id) : null;

  return (
    <div>
      <Header
        title="Flow"
        icon={<FlowIcon className={ICON_SIZE} />}
        menu={[{ label: "Hide this view", onSelect: () => hide("/flow") }]}
        below={
          current && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Previous project"
                title="Previous project (←)"
                onClick={() => go(-1)}
                className="grid h-7 w-7 place-items-center rounded-md border border-border text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
              <div className="relative flex items-center">
                <span
                  className="pointer-events-none absolute left-2.5 h-2 w-2 rounded-full"
                  style={{ background: areaColorVar(area?.color) }}
                />
                <select
                  value={current.id}
                  onChange={(e) => setViewDefault("/flow", { flowProject: e.target.value })}
                  aria-label="Jump to project"
                  className="h-8 min-w-56 rounded-md border border-input bg-surface pl-6 pr-7 text-sm font-medium text-foreground outline-none focus:border-primary"
                >
                  {active.map((p) => {
                    const n = readyCounts.get(p.id) ?? 0;
                    return (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {n > 0 ? ` · ${n} ready` : ""}
                      </option>
                    );
                  })}
                </select>
              </div>
              <button
                type="button"
                aria-label="Next project"
                title="Next project (→)"
                onClick={() => go(1)}
                className="grid h-7 w-7 place-items-center rounded-md border border-border text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>
              <span className="text-[11px] text-subtle">
                {idx + 1} / {active.length}
              </span>
            </div>
          )
        }
      />

      {current ? (
        <ProjectFlow key={current.id} project={current} />
      ) : (
        <p className="mt-6 text-sm text-subtle">No active projects yet.</p>
      )}
    </div>
  );
}
