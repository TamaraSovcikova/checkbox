// The Flow page: every project's runway on one surface, for the "where does
// each venture stand" review. A chip row (All / per-project, with green ready
// counts) filters the stacked sections; each section reuses ProjectFlow in
// compact mode (canvas only, shelves collapsed to a count line, no repeated
// legend). All sections render expanded: collapsed-by-default hides the
// content a page exists to show (the Pins page taught that one).

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Header } from "./components/PageHeader";
import { ProjectFlow } from "./components/ProjectFlow";
import { useAreas, useProjects, useTasks, useViewPrefs } from "./lib/queries";
import { readyCountsByProject } from "../shared/flow";
import { FlowIcon, ICON_SIZE } from "./lib/icons";
import { areaColorVar } from "./lib/colors";
import { cn } from "@/lib/utils";

export default function FlowPage() {
  const { data: projects = [] } = useProjects();
  const { data: areas = [] } = useAreas();
  const { hide } = useViewPrefs();
  // One flat open-task query feeds every chip count; the sections' own
  // per-project queries share the cache with the project tabs.
  const allOpen = useTasks({}).data;
  const readyCounts = useMemo(
    () => readyCountsByProject(allOpen ?? []),
    [allOpen]
  );
  const [sel, setSel] = useState<string>("all");

  const active = projects.filter((p) => p.status === "active");
  const shown = sel === "all" ? active : active.filter((p) => p.id === sel);
  // A chip pointing at a project that stopped existing falls back to All.
  if (sel !== "all" && shown.length === 0) setSel("all");

  const chip = (id: string, label: string, count: number | null) => (
    <button
      key={id}
      type="button"
      onClick={() => setSel(id)}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs transition-colors",
        sel === id
          ? "border-border bg-surface-2 text-foreground"
          : "border-border text-muted hover:bg-surface-2/60 hover:text-foreground"
      )}
    >
      {label}
      {count != null && count > 0 && (
        <span className="ml-1.5 font-semibold" style={{ color: "var(--success, #34d399)" }}>
          {count}
        </span>
      )}
    </button>
  );

  return (
    <div>
      <Header
        title="Flow"
        icon={<FlowIcon className={ICON_SIZE} />}
        menu={[{ label: "Hide this view", onSelect: () => hide("/flow") }]}
        below={
          <div className="flex flex-wrap items-center gap-1.5">
            {chip(
              "all",
              "All",
              [...readyCounts.values()].reduce((a, b) => a + b, 0) || null
            )}
            {active.map((p) => chip(p.id, p.name, readyCounts.get(p.id) ?? null))}
          </div>
        }
      />

      {active.length === 0 && (
        <p className="mt-6 text-sm text-subtle">No active projects yet.</p>
      )}

      <div className="space-y-8">
        {shown.map((p) => {
          const area = areas.find((a) => a.id === p.area_id);
          const ready = readyCounts.get(p.id) ?? 0;
          return (
            <section key={p.id}>
              <div className="mb-1 flex items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: areaColorVar(area?.color) }}
                />
                <Link
                  to={`/project/${p.id}`}
                  className="text-sm font-semibold text-foreground transition-colors hover:text-primary"
                >
                  {p.name}
                </Link>
                {ready > 0 && (
                  <span
                    className="text-[10.5px] font-semibold"
                    style={{ color: "var(--success, #34d399)" }}
                  >
                    {ready} ready
                  </span>
                )}
              </div>
              <ProjectFlow project={p} compact />
            </section>
          );
        })}
      </div>

      {/* One legend for the whole page; the sections skip theirs. */}
      {shown.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-subtle">
          <span>
            <span
              className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[3px] border"
              style={{ borderColor: "var(--success, #34d399)" }}
            />
            green = work on it now
          </span>
          <span className="opacity-80">dimmed = waiting · says after what</span>
          <span>
            <span className="mr-1.5 inline-block h-[5px] w-6 rounded bg-primary align-middle" />
            spine
          </span>
          <span>crossed out = completed today, gone tomorrow</span>
        </div>
      )}
    </div>
  );
}
