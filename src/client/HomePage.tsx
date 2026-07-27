// Home: the dashboard. Today kept becoming one by accretion (timeline,
// cadences, cards, capacity, banners), which taxed its real job of executing
// today's list; this page is where overview lives instead, composed by the
// user. See the vault's DESIGN-dashboard.md for the plan this implements (M1).
//
// A widget = a catalog entry rendering a self-contained card. The layout
// (which widgets, what order, what size) persists in UserPrefs.dashboard;
// undefined means never-customised and renders the starter layout, while an
// emptied dashboard stays empty (removal is a real choice). Edit mode mirrors
// the sidebar's: reorder with arrows, cycle sizes, remove, add from the
// catalog. Widgets orient and jump; none of them edit tasks in place.

import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Header } from "./components/PageHeader";
import { TodayTimeline } from "./components/TodayTimeline";
import { CapacityLine } from "./components/CapacityLine";
import {
  useAreas,
  useProjects,
  useTasks,
  useView,
  useViewPrefs,
} from "./lib/queries";
import { useTaskUI } from "./lib/ui-context";
import { readyCountsByProject } from "../shared/flow";
import { dueLabel } from "./lib/due";
import { areaColorVar } from "./lib/colors";
import { cn, todayStr } from "@/lib/utils";
import type { DashboardItem, Task } from "../shared/types";
import {
  HomeIcon,
  ICON_SIZE,
  TodayIcon,
  OverdueIcon,
  CalendarIcon,
  AddIcon,
  CloseIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FlowIcon,
} from "./lib/icons";

const CATALOG: { key: string; title: string; desc: string; size: DashboardItem["size"] }[] = [
  { key: "today", title: "Today at a glance", desc: "counts, capacity, the top of the list", size: "M" },
  { key: "starred", title: "Starred projects", desc: "your shortlist, with what is ready next", size: "M" },
  { key: "overdue", title: "Overdue", desc: "what slipped, before it compounds", size: "S" },
  { key: "timeline", title: "Day timeline", desc: "today's blocks on the clock", size: "M" },
];

const DEFAULT_LAYOUT: DashboardItem[] = [
  { widget: "today", size: "M" },
  { widget: "starred", size: "M" },
  { widget: "overdue", size: "S" },
  { widget: "timeline", size: "M" },
];

// S/M/L widths on the xl 3-column grid; everything stacks full-width on mobile.
const SIZE_CLASS: Record<DashboardItem["size"], string> = {
  S: "xl:col-span-1",
  M: "xl:col-span-2",
  L: "xl:col-span-3",
};

const priorityTone = (p: number) =>
  p === 1 ? "text-danger" : p === 2 ? "text-warning" : "text-subtle";

function Shell({
  title,
  to,
  children,
}: {
  title: string;
  to: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-surface/40 p-3.5">
      <Link
        to={to}
        className="mb-2.5 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-subtle transition-colors hover:text-foreground"
      >
        {title}
        <ChevronRightIcon className="h-3 w-3" />
      </Link>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function TaskLine({ t, today }: { t: Task; today: string }) {
  const { open } = useTaskUI();
  return (
    <button
      type="button"
      onClick={() => open(t)}
      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] text-foreground transition-colors hover:bg-surface-2"
    >
      {t.priority <= 2 && (
        <span className={cn("text-[10px] font-bold", priorityTone(t.priority))}>
          P{t.priority}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{t.title}</span>
      {t.due_date && (
        <span
          className={cn(
            "shrink-0 text-[10.5px]",
            t.due_date < today ? "text-danger" : "text-subtle"
          )}
        >
          {dueLabel(t.due_date, today)}
        </span>
      )}
    </button>
  );
}

function TodayGlance() {
  const { data: open = [] } = useView("today");
  const { data: done = [] } = useView("completed-today");
  const today = todayStr();
  const top = [...open].sort(
    (a, b) =>
      a.priority - b.priority ||
      (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")
  );
  return (
    <Shell title="Today" to="/today">
      <p className="mb-1.5 text-sm text-foreground">
        <span className="font-semibold">{open.length} open</span>
        <span className="text-subtle"> · {done.length} done today</span>
      </p>
      <div className="mb-2 text-xs">
        <CapacityLine tasks={open} />
      </div>
      {top.slice(0, 3).map((t) => (
        <TaskLine key={t.id} t={t} today={today} />
      ))}
      {open.length === 0 && (
        <p className="text-xs text-subtle">Nothing on the list. Enjoy it.</p>
      )}
    </Shell>
  );
}

function Starred() {
  const { data: projects = [] } = useProjects();
  const { data: areas = [] } = useAreas();
  const allOpen = useTasks({}).data ?? [];
  const ready = readyCountsByProject(allOpen);
  const today = todayStr();
  const starred = projects.filter((p) => !!p.starred && p.status === "active");

  // The next ready task per project: open, every blocker done, most pressing
  // first. Same readiness rule the runway uses.
  const nextReady = (projectId: string): Task | null => {
    const cand = allOpen
      .filter(
        (t) =>
          t.project_id === projectId &&
          t.status !== "done" &&
          (t.depends_on ?? []).every((d) => d.status === "done")
      )
      .sort(
        (a, b) =>
          (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
          a.priority - b.priority
      );
    return cand[0] ?? null;
  };

  return (
    <Shell title="Starred projects" to="/flow">
      {starred.length === 0 && (
        <p className="text-xs text-subtle">
          Star a project from its ⋯ menu and it lives here.
        </p>
      )}
      <div className="space-y-1.5">
        {starred.map((p) => {
          const area = areas.find((a) => a.id === p.area_id);
          const next = nextReady(p.id);
          const openCount = allOpen.filter((t) => t.project_id === p.id).length;
          return (
            <Link
              key={p.id}
              to={`/project/${p.id}`}
              className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-2 transition-colors hover:bg-surface-2"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: areaColorVar(area?.color) }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-foreground">
                  {p.name}
                </span>
                {next && (
                  <span className="block truncate text-[11px] text-subtle">
                    next: {next.title}
                    {next.due_date ? ` · ${dueLabel(next.due_date, today)}` : ""}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-right text-[10.5px] leading-tight">
                <span
                  className="block font-semibold"
                  style={{ color: "var(--success, #34d399)" }}
                >
                  {ready.get(p.id) ?? 0} ready
                </span>
                <span className="text-subtle">{openCount} open</span>
              </span>
            </Link>
          );
        })}
      </div>
    </Shell>
  );
}

function Overdue() {
  const { data: overdue = [] } = useView("overdue");
  const today = todayStr();
  return (
    <Shell title="Overdue" to="/overdue">
      {overdue.length === 0 ? (
        <p className="text-xs text-subtle">Nothing slipped. Clean slate.</p>
      ) : (
        <>
          <p className="mb-1.5 text-2xl font-bold text-danger">{overdue.length}</p>
          {overdue.slice(0, 3).map((t) => (
            <TaskLine key={t.id} t={t} today={today} />
          ))}
        </>
      )}
    </Shell>
  );
}

function Timeline() {
  const { data: tasks = [] } = useView("today");
  return (
    <Shell title="Day timeline" to="/calendar">
      <TodayTimeline tasks={tasks} />
    </Shell>
  );
}

const WIDGETS: Record<string, () => ReactNode> = {
  today: () => <TodayGlance />,
  starred: () => <Starred />,
  overdue: () => <Overdue />,
  timeline: () => <Timeline />,
};

const WIDGET_ICON: Record<string, typeof TodayIcon> = {
  today: TodayIcon,
  starred: FlowIcon,
  overdue: OverdueIcon,
  timeline: CalendarIcon,
};

export default function HomePage() {
  const { hide, dashboard, setDashboard } = useViewPrefs();
  const [editing, setEditing] = useState(false);
  // Undefined = never customised: render (and later edit from) the default.
  const layout = dashboard ?? DEFAULT_LAYOUT;

  const mutate = (next: DashboardItem[]) => setDashboard(next);
  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= layout.length) return;
    const next = layout.slice();
    [next[i], next[j]] = [next[j], next[i]];
    mutate(next);
  };
  const cycleSize = (i: number) => {
    const order: DashboardItem["size"][] = ["S", "M", "L"];
    const next = layout.slice();
    next[i] = {
      ...next[i],
      size: order[(order.indexOf(next[i].size) + 1) % order.length],
    };
    mutate(next);
  };
  const remove = (i: number) => mutate(layout.filter((_, k) => k !== i));
  const add = (key: string) => {
    const entry = CATALOG.find((c) => c.key === key)!;
    mutate([...layout, { widget: key, size: entry.size }]);
  };

  const missing = CATALOG.filter((c) => !layout.some((l) => l.widget === c.key));

  return (
    <div>
      <Header
        title="Home"
        icon={<HomeIcon className={ICON_SIZE} />}
        menu={[
          {
            label: editing ? "Done editing" : "Edit dashboard",
            onSelect: () => setEditing((e) => !e),
          },
          { label: "Hide this view", onSelect: () => hide("/home") },
        ]}
      />

      {editing && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border p-2.5 text-xs text-muted">
          <span className="font-medium text-foreground">Editing</span>
          <span>arrows reorder · S/M/L resizes · ✕ removes</span>
          {missing.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => add(c.key)}
              title={c.desc}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <AddIcon className="h-3 w-3" />
              {c.title}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="ml-auto rounded-md bg-surface-2 px-2.5 py-1 font-medium text-foreground"
          >
            Done
          </button>
        </div>
      )}

      {layout.length === 0 ? (
        <div className="mt-8 text-center text-sm text-subtle">
          <p className="mb-3">An empty dashboard. Add your first widget:</p>
          <div className="flex flex-wrap justify-center gap-2">
            {CATALOG.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => add(c.key)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-surface-2"
              >
                + {c.title}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {layout.map((item, i) => {
            const Icon = WIDGET_ICON[item.widget];
            return (
              <div key={`${item.widget}-${i}`} className={cn("relative", SIZE_CLASS[item.size])}>
                {editing && (
                  <div className="absolute -top-2.5 right-2 z-10 flex items-center gap-1 rounded-full border border-border bg-surface px-1.5 py-0.5 text-[10.5px] text-muted shadow-sm">
                    {Icon && <Icon className="h-3 w-3" />}
                    <button type="button" title="Move left/up" onClick={() => move(i, -1)} className="hover:text-foreground">
                      <ChevronLeftIcon className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" title="Move right/down" onClick={() => move(i, 1)} className="hover:text-foreground">
                      <ChevronRightIcon className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" title="Cycle size" onClick={() => cycleSize(i)} className="w-4 text-center font-semibold hover:text-foreground">
                      {item.size}
                    </button>
                    <button type="button" title="Remove widget" onClick={() => remove(i)} className="hover:text-danger">
                      <CloseIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {WIDGETS[item.widget]?.() ?? (
                  <div className="rounded-xl border border-dashed border-border p-4 text-xs text-subtle">
                    Unknown widget "{item.widget}" (from a newer version?)
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
