// Home: the dashboard. Today kept becoming one by accretion; this page is
// where overview lives instead, composed by the user. DESIGN-dashboard.md
// holds the plan; this file is M2: a FREE grid (drag anywhere, resize by the
// corner, 12 columns, react-grid-layout) and generic pinning, where a widget
// can be any view, any project, any area, or one of the specials.
//
// Layout persists per item as {x,y,w,h} on the 12-column canvas
// (UserPrefs.dashboard). Items saved before the free grid carry only `size`
// and are migrated on read. Dragging and resizing are enabled only in edit
// mode, so a stray drag can never rearrange the page mid-use; in edit mode
// links and buttons are excluded from the drag surface. Below md the grid
// renders as a simple stack in reading order (top-left first): phone screens
// have no meaningful x-axis to arrange on.

import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { GridLayout, useContainerWidth, noCompactor, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import { Header } from "./components/PageHeader";
import { TodayTimeline } from "./components/TodayTimeline";
import { CapacityLine } from "./components/CapacityLine";
import { CadenceStrip } from "./components/Cadences";
import { QuickCapture } from "./components/QuickCapture";
import {
  useAreas,
  useMailCandidates,
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
  AddIcon,
  CloseIcon,
  ChevronRightIcon,
} from "./lib/icons";

// ── Catalog ──────────────────────────────────────────────────────────────────
// Specials are fixed keys; anything else pins by reference: view:<name>,
// project:<id>, area:<id>. Adding a kind = a renderer branch + a picker row.

const SPECIALS: { key: string; title: string; desc: string; w: number; h: number }[] = [
  { key: "today", title: "Today at a glance", desc: "counts, capacity, the top of the list", w: 6, h: 4 },
  { key: "starred", title: "Starred projects", desc: "your shortlist, with what is ready next", w: 6, h: 4 },
  { key: "overdue", title: "Overdue", desc: "what slipped, before it compounds", w: 3, h: 4 },
  { key: "timeline", title: "Day timeline", desc: "today's blocks on the clock", w: 4, h: 6 },
  { key: "cadences", title: "Cadences", desc: "who and what is falling behind", w: 4, h: 4 },
  { key: "capture", title: "Quick capture", desc: "type a task from here, lands in Backlog", w: 6, h: 2 },
  { key: "mail", title: "Mail coverage", desc: "pending threads that need a look", w: 3, h: 3 },
];

const PINNABLE_VIEWS = ["upcoming", "backlog", "snoozed", "logbook"] as const;
const VIEW_TITLES: Record<string, string> = {
  upcoming: "Upcoming",
  backlog: "Backlog",
  snoozed: "Snoozed",
  logbook: "Logbook",
};

const DEFAULT_LAYOUT: DashboardItem[] = [
  { widget: "today", x: 0, y: 0, w: 6, h: 4 },
  { widget: "overdue", x: 6, y: 0, w: 3, h: 4 },
  { widget: "timeline", x: 9, y: 0, w: 3, h: 8 },
  { widget: "starred", x: 0, y: 4, w: 9, h: 4 },
];

const LEGACY_W: Record<string, number> = { S: 4, M: 8, L: 12 };

// Items from before the free grid carry only `size`; give them coordinates
// once, stacked in saved order, and the next edit persists real ones.
function migrate(items: DashboardItem[]): DashboardItem[] {
  let y = 0;
  return items.map((it) => {
    if (it.x != null && it.y != null && it.w != null && it.h != null) return it;
    const w = it.w ?? LEGACY_W[it.size ?? "M"] ?? 8;
    const h = it.h ?? 4;
    const placed = { ...it, x: 0, y, w, h };
    y += h;
    return placed;
  });
}

const priorityTone = (p: number) =>
  p === 1 ? "text-danger" : p === 2 ? "text-warning" : "text-subtle";

// ── Widget building blocks ───────────────────────────────────────────────────

function Shell({ title, to, children }: { title: string; to: string; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface/40 p-3.5">
      <Link
        to={to}
        className="mb-2 flex shrink-0 items-center gap-1 text-xs font-semibold uppercase tracking-wide text-subtle transition-colors hover:text-foreground"
      >
        {title}
        <ChevronRightIcon className="h-3 w-3" />
      </Link>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
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
        <span className={cn("text-[10px] font-bold", priorityTone(t.priority))}>P{t.priority}</span>
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

// The generic pinned-list body: any set of tasks, most pressing first.
function TaskListBody({ tasks, emptyText }: { tasks: Task[]; emptyText: string }) {
  const today = todayStr();
  const sorted = [...tasks].sort(
    (a, b) =>
      (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
      a.priority - b.priority
  );
  if (sorted.length === 0) return <p className="text-xs text-subtle">{emptyText}</p>;
  return (
    <>
      {sorted.map((t) => (
        <TaskLine key={t.id} t={t} today={today} />
      ))}
    </>
  );
}

function TodayGlance() {
  const { data: open = [] } = useView("today");
  const { data: done = [] } = useView("completed-today");
  const today = todayStr();
  const top = [...open].sort(
    (a, b) => a.priority - b.priority || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")
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
      {top.map((t) => (
        <TaskLine key={t.id} t={t} today={today} />
      ))}
      {open.length === 0 && <p className="text-xs text-subtle">Nothing on the list. Enjoy it.</p>}
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
          (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.priority - b.priority
      );
    return cand[0] ?? null;
  };
  return (
    <Shell title="Starred projects" to="/flow">
      {starred.length === 0 && (
        <p className="text-xs text-subtle">Star a project from its ⋯ menu and it lives here.</p>
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
                <span className="block font-semibold" style={{ color: "var(--success, #34d399)" }}>
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

function OverdueWidget() {
  const { data: overdue = [] } = useView("overdue");
  return (
    <Shell title="Overdue" to="/overdue">
      {overdue.length === 0 ? (
        <p className="text-xs text-subtle">Nothing slipped. Clean slate.</p>
      ) : (
        <>
          <p className="mb-1.5 text-2xl font-bold text-danger">{overdue.length}</p>
          <TaskListBody tasks={overdue} emptyText="" />
        </>
      )}
    </Shell>
  );
}

function TimelineWidget() {
  const { data: tasks = [] } = useView("today");
  return (
    <Shell title="Day timeline" to="/calendar">
      <TodayTimeline tasks={tasks} />
    </Shell>
  );
}

function CadencesWidget() {
  return (
    <Shell title="Cadences" to="/cadences">
      <CadenceStrip limit={8} />
    </Shell>
  );
}

function CaptureWidget() {
  return (
    <Shell title="Quick capture" to="/backlog">
      <QuickCapture />
    </Shell>
  );
}

function MailWidget() {
  const { data: candidates = [] } = useMailCandidates();
  const pending = candidates.filter((c) => c.verdict === "pending");
  return (
    <Shell title="Mail coverage" to="/mail">
      {pending.length === 0 ? (
        <p className="text-xs text-subtle">Inbox covered.</p>
      ) : (
        <>
          <p className="mb-1 text-2xl font-bold text-foreground">{pending.length}</p>
          <p className="text-xs text-subtle">threads waiting on a look</p>
        </>
      )}
    </Shell>
  );
}

function ViewWidget({ name }: { name: string }) {
  const { data: tasks = [] } = useView(name);
  return (
    <Shell title={VIEW_TITLES[name] ?? name} to={`/${name}`}>
      <p className="mb-1.5 text-sm font-semibold text-foreground">{tasks.length}</p>
      <TaskListBody tasks={tasks} emptyText="Empty." />
    </Shell>
  );
}

function ProjectWidget({ id }: { id: string }) {
  const { data: projects = [] } = useProjects();
  const { data: tasks = [] } = useTasks({ project_id: id });
  const p = projects.find((x) => x.id === id);
  return (
    <Shell title={p?.name ?? "(deleted project)"} to={`/project/${id}`}>
      <TaskListBody tasks={tasks} emptyText="No open tasks." />
    </Shell>
  );
}

function AreaWidget({ id }: { id: string }) {
  const { data: areas = [] } = useAreas();
  const { data: tasks = [] } = useTasks({ area_id: id });
  const a = areas.find((x) => x.id === id);
  return (
    <Shell title={a?.name ?? "(deleted area)"} to={`/area/${id}`}>
      <TaskListBody tasks={tasks} emptyText="No open tasks." />
    </Shell>
  );
}

function renderWidget(key: string): ReactNode {
  if (key.startsWith("view:")) return <ViewWidget name={key.slice(5)} />;
  if (key.startsWith("project:")) return <ProjectWidget id={key.slice(8)} />;
  if (key.startsWith("area:")) return <AreaWidget id={key.slice(5)} />;
  switch (key) {
    case "today":
      return <TodayGlance />;
    case "starred":
      return <Starred />;
    case "overdue":
      return <OverdueWidget />;
    case "timeline":
      return <TimelineWidget />;
    case "cadences":
      return <CadencesWidget />;
    case "capture":
      return <CaptureWidget />;
    case "mail":
      return <MailWidget />;
    default:
      return (
        <div className="h-full rounded-xl border border-dashed border-border p-4 text-xs text-subtle">
          Unknown widget "{key}" (from a newer version?)
        </div>
      );
  }
}

// ── The add-anything picker ──────────────────────────────────────────────────

function AddPicker({ onAdd }: { onAdd: (key: string, w: number, h: number) => void }) {
  const { data: projects = [] } = useProjects();
  const { data: areas = [] } = useAreas();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const match = (s: string) => !needle || s.toLowerCase().includes(needle);

  const section = (label: string, rows: ReactNode[]) =>
    rows.length > 0 && (
      <div>
        <p className="mb-1 mt-2 text-[10px] font-bold uppercase tracking-wide text-subtle">{label}</p>
        <div className="flex flex-wrap gap-1.5">{rows}</div>
      </div>
    );

  const chip = (key: string, label: string, w: number, h: number, title?: string) => (
    <button
      key={key}
      type="button"
      title={title}
      onClick={() => onAdd(key, w, h)}
      className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
    >
      <AddIcon className="h-3 w-3" />
      {label}
    </button>
  );

  return (
    <div className="rounded-xl border border-dashed border-border p-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter: a project, an area, a view..."
        className="mb-1 h-8 w-full max-w-sm rounded-md border border-input bg-surface px-2.5 text-xs text-foreground outline-none focus:border-primary"
      />
      {section(
        "Widgets",
        SPECIALS.filter((s) => match(s.title)).map((s) => chip(s.key, s.title, s.w, s.h, s.desc))
      )}
      {section(
        "Views",
        PINNABLE_VIEWS.filter((v) => match(VIEW_TITLES[v])).map((v) =>
          chip(`view:${v}`, VIEW_TITLES[v], 4, 4)
        )
      )}
      {section(
        "Projects",
        projects
          .filter((p) => p.status === "active" && match(p.name))
          .map((p) => chip(`project:${p.id}`, p.name, 4, 4))
      )}
      {section(
        "Areas",
        areas.filter((a) => match(a.name)).map((a) => chip(`area:${a.id}`, a.name, 4, 4))
      )}
    </div>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────

const ROW_H = 72;

export default function HomePage() {
  const { hide, dashboard, setDashboard } = useViewPrefs();
  const [editing, setEditing] = useState(false);
  const { width, containerRef, mounted } = useContainerWidth();

  const items = useMemo(() => migrate(dashboard ?? DEFAULT_LAYOUT), [dashboard]);

  // Stable per-position ids: the same widget can be pinned twice.
  const gridLayout: Layout = items.map((it, i) => ({
    i: `${i}:${it.widget}`,
    x: it.x!,
    y: it.y!,
    w: it.w!,
    h: it.h!,
  }));

  // Persist only edits: RGL also calls onLayoutChange on mount and when the
  // container width settles, and saving those would loop the prefs write.
  const onLayoutChange = (next: Layout) => {
    if (!editing) return;
    const byId = new Map(next.map((l) => [l.i, l]));
    const merged = items.map((it, i) => {
      const l = byId.get(`${i}:${it.widget}`);
      return l ? { ...it, x: l.x, y: l.y, w: l.w, h: l.h } : it;
    });
    if (JSON.stringify(merged) !== JSON.stringify(items)) setDashboard(merged);
  };

  const remove = (i: number) => setDashboard(items.filter((_, k) => k !== i));
  const add = (key: string, w: number, h: number) => {
    const bottom = items.reduce((m, it) => Math.max(m, (it.y ?? 0) + (it.h ?? 4)), 0);
    setDashboard([...items, { widget: key, x: 0, y: bottom, w, h }]);
  };

  // Mobile reading order: top-left first.
  const stacked = items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => (a.it.y! - b.it.y!) || (a.it.x! - b.it.x!));

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
        <div className="mb-3 space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="font-medium text-foreground">Editing</span>
            <span>drag a card anywhere · resize from its corner · ✕ removes</span>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="ml-auto rounded-md bg-surface-2 px-2.5 py-1 font-medium text-foreground"
            >
              Done
            </button>
          </div>
          <AddPicker onAdd={add} />
        </div>
      )}

      {items.length === 0 ? (
        <div className="mt-8 text-center text-sm text-subtle">
          <p className="mb-3">An empty dashboard. Open Edit and add your first widget.</p>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-surface-2"
            >
              Edit dashboard
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop: the free grid. */}
          <div ref={containerRef} className="hidden md:block">
            {mounted && width > 0 && (
              <GridLayout
                layout={gridLayout}
                width={width}
                gridConfig={{ cols: 12, rowHeight: ROW_H, margin: [12, 12] }}
                // Free placement: no auto-compaction, so a card stays exactly
                // where she drops it, gaps and all.
                compactor={noCompactor}
                dragConfig={{ enabled: editing, cancel: "a,button,input,select,textarea" }}
                resizeConfig={{ enabled: editing }}
                onLayoutChange={onLayoutChange}
              >
                {items.map((it, i) => (
                  <div key={`${i}:${it.widget}`} className={cn("group/w relative", editing && "select-none")}>
                    {editing && (
                      <button
                        type="button"
                        title="Remove widget"
                        onClick={() => remove(i)}
                        className="absolute -right-1.5 -top-1.5 z-20 grid h-5 w-5 place-items-center rounded-full border border-border bg-surface text-muted shadow-sm hover:text-danger"
                      >
                        <CloseIcon className="h-3 w-3" />
                      </button>
                    )}
                    {renderWidget(it.widget)}
                  </div>
                ))}
              </GridLayout>
            )}
          </div>
          {/* Mobile: stacked in reading order. */}
          <div className="space-y-3 md:hidden">
            {stacked.map(({ it, i }) => (
              <div key={`${i}:${it.widget}`} className="relative" style={{ minHeight: 120 }}>
                {editing && (
                  <button
                    type="button"
                    title="Remove widget"
                    onClick={() => remove(i)}
                    className="absolute -right-1.5 -top-1.5 z-20 grid h-5 w-5 place-items-center rounded-full border border-border bg-surface text-muted shadow-sm hover:text-danger"
                  >
                    <CloseIcon className="h-3 w-3" />
                  </button>
                )}
                {renderWidget(it.widget)}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
