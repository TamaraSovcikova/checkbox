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
import {
  GridLayout,
  useContainerWidth,
  noCompactor,
  type Compactor,
  type Layout,
} from "react-grid-layout";
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
// Rendered as a floating menu: from the + button, or from a right-click
// anywhere on the canvas (which also remembers WHERE you clicked, so the
// widget lands under the cursor). The permanent config strip this replaces
// was her words: "terrible".

function PickerMenu({
  at,
  onAdd,
  onClose,
}: {
  at: { x: number; y: number };
  onAdd: (key: string, w: number, h: number) => void;
  onClose: () => void;
}) {
  const { data: projects = [] } = useProjects();
  const { data: areas = [] } = useAreas();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const match = (s: string) => !needle || s.toLowerCase().includes(needle);

  const row = (key: string, label: string, w: number, h: number, desc?: string) => (
    <button
      key={key}
      type="button"
      title={desc}
      onClick={() => {
        onAdd(key, w, h);
        onClose();
      }}
      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
    >
      <AddIcon className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );

  const section = (label: string, rows: ReactNode[]) =>
    rows.length > 0 && (
      <div key={label}>
        <p className="mb-0.5 mt-2 px-2 text-[10px] font-bold uppercase tracking-wide text-subtle">
          {label}
        </p>
        {rows}
      </div>
    );

  const left = Math.min(at.x, window.innerWidth - 300);
  const top = Math.min(at.y, window.innerHeight - 380);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        style={{ left, top }}
        className="fixed z-50 w-72 rounded-xl border border-border bg-surface p-2 shadow-xl"
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
          placeholder="Add: widget, project, area, view..."
          className="mb-1 h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none focus:border-primary"
        />
        <div className="max-h-72 overflow-y-auto">
          {section(
            "Widgets",
            SPECIALS.filter((sp) => match(sp.title)).map((sp) => row(sp.key, sp.title, sp.w, sp.h, sp.desc))
          )}
          {section(
            "Views",
            PINNABLE_VIEWS.filter((v) => match(VIEW_TITLES[v])).map((v) =>
              row(`view:${v}`, VIEW_TITLES[v], 4, 4)
            )
          )}
          {section(
            "Projects",
            projects
              .filter((p) => p.status === "active" && match(p.name))
              .map((p) => row(`project:${p.id}`, p.name, 4, 4))
          )}
          {section(
            "Areas",
            areas.filter((a) => match(a.name)).map((a) => row(`area:${a.id}`, a.name, 4, 4))
          )}
        </div>
      </div>
    </>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────

const ROW_H = 72;
const GRID_MARGIN = 12;

// Free placement, and dragging one card moves ONLY that card: a drop that
// would land on another card snaps back instead of shoving the neighbourhood
// around (noCompactor alone pushes colliding items, which read as "boxes fly
// around randomly").
const freeCompactor: Compactor = { ...noCompactor, preventCollision: true };

const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x?: number; y?: number; w?: number; h?: number }
) =>
  a.x < (b.x ?? 0) + (b.w ?? 1) &&
  (b.x ?? 0) < a.x + a.w &&
  a.y < (b.y ?? 0) + (b.h ?? 1) &&
  (b.y ?? 0) < a.y + a.h;

export default function HomePage() {
  const { hide, dashboard, setDashboard } = useViewPrefs();
  // Editing works on a DRAFT and persists once on Done. Saving every drag
  // step fed the grid its own layout mid-gesture and made cards jump.
  const [draft, setDraft] = useState<DashboardItem[] | null>(null);
  const [picker, setPicker] = useState<{ x: number; y: number; cell?: { x: number; y: number } } | null>(null);
  const { width, containerRef, mounted } = useContainerWidth();

  const saved = useMemo(() => migrate(dashboard ?? DEFAULT_LAYOUT), [dashboard]);
  const editing = draft !== null;
  const items = draft ?? saved;

  const startEditing = () => setDraft(saved);
  const cancelEditing = () => setDraft(null);
  const doneEditing = () => {
    if (draft) setDashboard(draft);
    setDraft(null);
  };

  const gridLayout: Layout = items.map((it, i) => ({
    i: `${i}:${it.widget}`,
    x: it.x!,
    y: it.y!,
    w: it.w!,
    h: it.h!,
  }));

  const onLayoutChange = (next: Layout) => {
    if (!editing) return;
    const byId = new Map(next.map((l) => [l.i, l]));
    setDraft((cur) =>
      (cur ?? []).map((it, i) => {
        const l = byId.get(`${i}:${it.widget}`);
        return l ? { ...it, x: l.x, y: l.y, w: l.w, h: l.h } : it;
      })
    );
  };

  const apply = (next: DashboardItem[]) => {
    if (editing) setDraft(next);
    else setDashboard(next);
  };

  const remove = (i: number) => apply(items.filter((_, k) => k !== i));

  // Right-click add lands the widget under the cursor; the + button appends
  // below everything. Either way it never lands on top of an existing card:
  // nudged down until the spot is free.
  const add = (key: string, w: number, h: number) => {
    let x = 0;
    let y = items.reduce((m, it) => Math.max(m, (it.y ?? 0) + (it.h ?? 4)), 0);
    if (picker?.cell) {
      x = Math.max(0, Math.min(picker.cell.x, 12 - w));
      y = picker.cell.y;
      while (items.some((it) => overlaps({ x, y, w, h }, it))) y += 1;
    }
    apply([...items, { widget: key, x, y, w, h }]);
  };

  const onCanvasContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    const wrap = containerRef.current;
    if (!wrap) return;
    e.preventDefault();
    const r = wrap.getBoundingClientRect();
    const colW = (r.width - GRID_MARGIN * 13) / 12;
    const cell = {
      x: Math.max(0, Math.min(11, Math.floor((e.clientX - r.left) / (colW + GRID_MARGIN)))),
      y: Math.max(0, Math.floor((e.clientY - r.top) / (ROW_H + GRID_MARGIN))),
    };
    setPicker({ x: e.clientX, y: e.clientY, cell });
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
          editing
            ? { label: "Done editing", onSelect: doneEditing }
            : { label: "Edit dashboard", onSelect: startEditing },
          { label: "Hide this view", onSelect: () => hide("/home") },
        ]}
      />

      {items.length === 0 ? (
        <div className="mt-8 text-center text-sm text-subtle">
          <p className="mb-3">An empty dashboard. Right-click anywhere, or:</p>
          <button
            type="button"
            onClick={(e) => setPicker({ x: e.clientX, y: e.clientY })}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-surface-2"
          >
            + Add a widget
          </button>
        </div>
      ) : (
        <>
          {/* Desktop: the free canvas. Right-click adds a widget at the spot. */}
          <div ref={containerRef} onContextMenu={onCanvasContextMenu} className="hidden min-h-[60vh] md:block">
            {mounted && width > 0 && (
              <GridLayout
                layout={gridLayout}
                width={width}
                gridConfig={{ cols: 12, rowHeight: ROW_H, margin: [GRID_MARGIN, GRID_MARGIN] }}
                compactor={freeCompactor}
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

      {/* Floating edit controls: the whole editing surface is the canvas
          itself plus this pill. No permanent config strip. */}
      {editing && (
        <div className="fixed bottom-5 right-5 z-40 flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-1.5 shadow-lg">
          <button
            type="button"
            onClick={(e) => setPicker({ x: e.clientX - 260, y: e.clientY - 380 })}
            className="rounded-full px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
          >
            + Add
          </button>
          <button
            type="button"
            onClick={cancelEditing}
            className="rounded-full px-2.5 py-1 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={doneEditing}
            className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90"
          >
            Done
          </button>
        </div>
      )}

      {picker && (
        <PickerMenu at={picker} onAdd={add} onClose={() => setPicker(null)} />
      )}
    </div>
  );
}
