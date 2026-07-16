import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { Project, Task, TriageSuggestion } from "../shared/types";
import {
  useAreas,
  useProjects,
  useTasks,
  useView,
  useTriageSuggestions,
  useTriageGenerate,
  useTriageAccept,
  useTriageReject,
  usePushStatus,
  useCalendarStatus,
  useCalendarFeeds,
  useSetCalendarFeed,
  useGmailStatus,
  useGmailRefresh,
  useSavedFilters,
  useFilterTasks,
  useDeleteFilter,
} from "./lib/queries";
import { FilterDialog } from "./components/FilterDialog";
import { AreaDialog } from "./components/AreaDialog";
import { ProjectDialog } from "./components/ProjectDialog";
import { CalendarSyncBanner } from "./components/CalendarSyncBanner";
import { SuggestToday } from "./components/SuggestToday";
import { PinsStrip, PinsSide } from "./components/Pins";
import { StatsWidget } from "./components/StatsWidget";
import { CheatSheet } from "./components/CheatSheet";
import { NotesInbox } from "./components/NotesInbox";
import { InstallHint } from "./components/InstallHint";
import { FilterIcon, SnoozeIcon, ReviewIcon } from "./lib/icons";
import { areaColorVar } from "./lib/colors";
import { areaIcon } from "./lib/icons";
import { useReview } from "./lib/queries";
import { useTaskUI, useMe } from "./lib/ui-context";
import { useTheme, PALETTES, FONTS, type ThemePref } from "./lib/theme";
import { QuickCapture } from "./components/QuickCapture";
import { ProjectBoard } from "./components/ProjectBoard";
import { TodayBoard } from "./components/TodayBoard";
import { TaskRow } from "./components/TaskRow";
import {
  useTaskSelection,
  BulkActionBar,
  type TaskControls,
} from "./components/TaskListControls";
import { TopBar, type Tab, type MenuChoice } from "./components/TopBar";
import {
  GridIcon,
  ListIcon,
  BoardIcon,
  TodayIcon,
  UpcomingIcon,
  OverdueIcon,
  BacklogIcon,
  LogbookIcon,
  ChevronRightIcon,
  BackIcon,
  ICON_SIZE,
} from "./lib/icons";
import { areaTintBg, shouldPill } from "./lib/colors";
import { useViewPrefs } from "./lib/queries";
import { Button, cx, PriorityPill } from "./components/ui";
import { todayStr } from "./lib/utils";
import { api } from "./lib/api";
import type { ComponentType, ReactNode } from "react";

function Header<T extends string>(props: {
  title: string;
  icon?: ReactNode;
  tabs?: Tab<T>[];
  activeTab?: T;
  onTab?: (id: T) => void;
  sort?: MenuChoice[];
  group?: MenuChoice[];
  filter?: MenuChoice[];
  menu?: MenuChoice[];
  actions?: ReactNode;
  below?: ReactNode;
}) {
  return <TopBar {...props} />;
}

function TaskList({
  tasks,
  empty,
  controls,
  indexOffset = 0,
}: {
  tasks: Task[];
  empty: string;
  controls?: TaskControls;
  indexOffset?: number;
}) {
  const { open } = useTaskUI();
  if (tasks.length === 0)
    return <p className="px-2 text-sm text-subtle">{empty}</p>;
  return (
    <div className="max-w-2xl">
      {tasks.map((t, i) => (
        <TaskRow
          key={t.id}
          task={t}
          onOpen={open}
          selection={controls?.rowFor(t, indexOffset + i)}
        />
      ))}
    </div>
  );
}

const VIEW_META: Record<
  string,
  { title: string; empty: string; icon: ComponentType<{ className?: string }> }
> = {
  today: { title: "Today", empty: "Nothing due today.", icon: TodayIcon },
  upcoming: { title: "Upcoming", empty: "Nothing upcoming.", icon: UpcomingIcon },
  overdue: { title: "Overdue", empty: "Nothing overdue. Nice.", icon: OverdueIcon },
  backlog: { title: "Backlog", empty: "Backlog is empty.", icon: BacklogIcon },
  logbook: { title: "Logbook", empty: "No completed tasks yet.", icon: LogbookIcon },
  snoozed: {
    title: "Snoozed",
    empty: "Nothing snoozed. Snooze a task to defer it here.",
    icon: SnoozeIcon,
  },
};

// ── Client-side sort / group over the fetched task list ───────────────────────

type SortKey = "manual" | "priority" | "due" | "title" | "created";
type GroupKey = "none" | "due" | "priority" | "area" | "project";

const SORT_LABEL: Record<SortKey, string> = {
  manual: "Manual",
  priority: "Priority",
  due: "Due date",
  title: "Title",
  created: "Date created",
};

const GROUP_LABEL: Record<GroupKey, string> = {
  none: "None",
  due: "Due",
  priority: "Priority",
  area: "Area",
  project: "Project",
};

// Bucket a task by due date into a fixed, chronological set of groups.
const DUE_ORDER = ["Overdue", "Today", "This week", "Later", "No date"];
function dueBucket(due: string | null, today: string): string {
  if (!due) return "No date";
  if (due < today) return "Overdue";
  if (due === today) return "Today";
  const [y, m, d] = today.split("-").map(Number);
  const wk = new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
  if (due <= wk) return "This week";
  return "Later";
}

function sortTasks(tasks: Task[], key: SortKey): Task[] {
  const arr = [...tasks];
  switch (key) {
    case "priority":
      return arr.sort((a, b) => a.priority - b.priority || a.position - b.position);
    case "due":
      return arr.sort((a, b) =>
        (a.due_date ?? "9999-99-99").localeCompare(b.due_date ?? "9999-99-99")
      );
    case "title":
      return arr.sort((a, b) => a.title.localeCompare(b.title));
    case "created":
      return arr.sort((a, b) => b.created_at.localeCompare(a.created_at));
    default:
      return arr.sort((a, b) => a.position - b.position);
  }
}

function groupTasks(
  tasks: Task[],
  key: GroupKey,
  names: { area: (id: string | null) => string; project: (id: string | null) => string }
): { label: string; tasks: Task[] }[] {
  if (key === "none") return [{ label: "", tasks }];

  // Due grouping uses fixed chronological buckets rather than alphabetical order.
  if (key === "due") {
    const today = todayStr();
    const groups = new Map<string, Task[]>();
    for (const t of tasks) {
      const label = dueBucket(t.due_date, today);
      (groups.get(label) ?? groups.set(label, []).get(label)!).push(t);
    }
    return DUE_ORDER.filter((l) => groups.has(l)).map((label) => ({
      label,
      tasks: groups.get(label)!,
    }));
  }

  const groups = new Map<string, Task[]>();
  for (const t of tasks) {
    const label =
      key === "priority"
        ? `Priority ${t.priority}`
        : key === "area"
        ? names.area(t.area_id)
        : names.project(t.project_id);
    (groups.get(label) ?? groups.set(label, []).get(label)!).push(t);
  }
  return [...groups.entries()]
    .map(([label, tasks]) => ({ label, tasks }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ── Filtering ────────────────────────────────────────────────────────────────

type FilterKey = "all" | "p1" | "p2" | "p3" | "p4" | "overdue" | "planned";

const FILTER_LABEL: Record<FilterKey, string> = {
  all: "All tasks",
  p1: "Priority 1",
  p2: "Priority 2",
  p3: "Priority 3",
  p4: "Priority 4",
  overdue: "Overdue",
  planned: "Planned for today",
};

function filterTasks(tasks: Task[], key: FilterKey): Task[] {
  if (key === "all") return tasks;
  const today = todayStr();
  if (key === "overdue")
    return tasks.filter((t) => t.due_date != null && t.due_date < today);
  if (key === "planned") return tasks.filter((t) => t.planned_date === today);
  const p = Number(key.slice(1));
  return tasks.filter((t) => t.priority === p);
}

// ── Shared task-collection controls ──────────────────────────────────────────
//
// Filter -> sort -> group -> render, plus the header menus and the keyboard/
// multi-select controls. ViewPage, AreaPage and ProjectPage all use this so the
// three surfaces behave identically and each remembers its own preferences
// (persisted per `prefsKey` in UserPrefs.viewDefaults).
function useTaskCollection(prefsKey: string, tasks: Task[], empty: string) {
  const { data: areas = [] } = useAreas();
  const { data: projects = [] } = useProjects();
  const { viewDefault, setViewDefault } = useViewPrefs();
  const { open } = useTaskUI();

  const vd = viewDefault(prefsKey);
  const view = (vd.mode ?? "list") as ViewMode;
  const sort = (vd.sort as SortKey) ?? "manual";
  const group = (vd.group as GroupKey) ?? "none";
  const filter = (vd.filter as FilterKey) ?? "all";

  const setView = (m: ViewMode) => setViewDefault(prefsKey, { mode: m });

  const names = {
    area: (id: string | null) => areas.find((a) => a.id === id)?.name ?? "No area",
    project: (id: string | null) =>
      projects.find((p) => p.id === id)?.name ?? "No project",
  };

  const groups = groupTasks(sortTasks(filterTasks(tasks, filter), sort), group, names);

  const menu = <K extends string>(
    labels: Record<K, string>,
    active: K,
    key: "sort" | "group" | "filter"
  ): MenuChoice[] =>
    (Object.keys(labels) as K[]).map((k) => ({
      label: labels[k],
      active: active === k,
      onSelect: () => setViewDefault(prefsKey, { [key]: k }),
    }));

  // Selection + keyboard nav run over the flattened, grouped order, only in list
  // view (grid keeps plain click-to-open). The running offset keeps each group's
  // rows in one continuous cursor sequence.
  const flat = groups.flatMap((g) => g.tasks);
  const controls = useTaskSelection(flat, open, view === "list");

  function renderBody(list: Task[], offset: number) {
    if (view === "grid") return <TaskGrid tasks={list} empty={empty} />;
    return (
      <TaskList tasks={list} empty={empty} controls={controls} indexOffset={offset} />
    );
  }

  let running = 0;
  const body =
    group === "none" ? (
      renderBody(groups[0].tasks, 0)
    ) : (
      <div className="space-y-6">
        {groups.map((g) => {
          const offset = running;
          running += g.tasks.length;
          return (
            <section key={g.label}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">
                {g.label} <span className="text-subtle">{g.tasks.length}</span>
              </h2>
              {renderBody(g.tasks, offset)}
            </section>
          );
        })}
      </div>
    );

  return {
    view,
    setView,
    controls,
    body,
    sortMenu: menu(SORT_LABEL, sort, "sort"),
    groupMenu: menu(GROUP_LABEL, group, "group"),
    filterMenu: menu(FILTER_LABEL, filter, "filter"),
  };
}

function TaskCard({ task, onOpen }: { task: Task; onOpen: (t: Task) => void }) {
  const { data: areas = [] } = useAreas();
  const area = areas.find((a) => a.id === task.area_id);
  const done = task.status === "done";
  const tint = areaTintBg(area?.color, 10);
  return (
    <button
      onClick={() => onOpen(task)}
      className="flex flex-col rounded-lg border border-border bg-surface/60 p-3 text-left transition-colors hover:border-primary/40"
      style={tint ? { backgroundColor: tint } : undefined}
    >
      <span className={cx("text-sm text-foreground", done && "text-subtle line-through")}>
        {task.title}
      </span>
      <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-subtle">
        {shouldPill(task.priority) && <PriorityPill priority={task.priority} />}
        {area && (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: areaColorVar(area.color) }}
            title={area.name}
          />
        )}
        {task.due_date && <span className="text-primary">{task.due_date}</span>}
        {(task.labels ?? []).map((l) => (
          <span key={l.id} className="text-muted">
            @{l.name}
          </span>
        ))}
      </span>
    </button>
  );
}

function TaskGrid({ tasks, empty }: { tasks: Task[]; empty: string }) {
  const { open } = useTaskUI();
  if (tasks.length === 0)
    return <p className="px-2 text-sm text-subtle">{empty}</p>;
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {tasks.map((t) => (
        <TaskCard key={t.id} task={t} onOpen={open} />
      ))}
    </div>
  );
}

type ViewMode = "grid" | "list" | "board";

const LIST_GRID_TABS: Tab<ViewMode>[] = [
  { id: "grid", label: "Grid", icon: <GridIcon className={ICON_SIZE} /> },
  { id: "list", label: "List", icon: <ListIcon className={ICON_SIZE} /> },
];
// Today also offers a To do / Doing / Done board you can drag between.
const TODAY_TABS: Tab<ViewMode>[] = [
  ...LIST_GRID_TABS,
  { id: "board", label: "Board", icon: <BoardIcon className={ICON_SIZE} /> },
];

export function ViewPage({ name }: { name: string }) {
  const { data: tasks = [] } = useView(name);
  // Today's board keeps a Done column, which the Today view (open tasks only)
  // can't fill, so pull today's completed tasks alongside. Cheap + cached.
  const { data: completedToday = [] } = useView("completed-today");
  const meta = VIEW_META[name];
  const { hide } = useViewPrefs();
  const { view, setView, controls, body, sortMenu, groupMenu, filterMenu } =
    useTaskCollection(`/${name}`, tasks, meta.empty);
  const isToday = name === "today";
  const showBoard = isToday && view === "board";

  return (
    <div>
      <Header
        title={meta.title}
        icon={<meta.icon className={ICON_SIZE} />}
        tabs={isToday ? TODAY_TABS : LIST_GRID_TABS}
        activeTab={view}
        onTab={setView}
        sort={sortMenu}
        group={groupMenu}
        filter={filterMenu}
        menu={[{ label: "Hide this view", onSelect: () => hide(`/${name}`) }]}
        below={
          name !== "logbook" ? (
            <div className="max-w-2xl">
              {/* Captured on Today -> planned for today, not dumped in Backlog. */}
              <QuickCapture
                defaultPlannedDate={name === "today" ? todayStr() : undefined}
              />
            </div>
          ) : undefined
        }
      />
      {isToday ? (
        // Today can carry pins on the side, so it lays out as main column + rail.
        <div className="lg:flex lg:gap-5">
          <div className="min-w-0 lg:flex-1">
            <InstallHint />
            <PinsStrip />
            <CheatSheet />
            <SuggestToday />
            {showBoard ? (
              // The board's Done column already shows today's completed tasks, so
              // the separate CompletedToday strip is redundant here.
              <TodayBoard open={tasks} done={completedToday} />
            ) : (
              <>
                {body}
                {view === "list" && <BulkActionBar controls={controls} />}
                <CompletedToday />
              </>
            )}
          </div>
          <PinsSide />
        </div>
      ) : (
        <>
          {name === "backlog" ? (
            <BacklogBody tasks={tasks} list={body} />
          ) : (
            body
          )}
          {view === "list" && <BulkActionBar controls={controls} />}
        </>
      )}
    </div>
  );
}

// A same-day history strip under Today: the tasks you ticked off today. It resets
// at midnight (keyed off today's date server-side) and each row stays un-checkable:
// clicking the circle restores the task to the active list. The full archive
// lives in the Logbook.
function CompletedToday() {
  const { data: done = [] } = useView("completed-today");
  const { open } = useTaskUI();
  const [expanded, setExpanded] = useState(true);
  if (done.length === 0) return null;
  return (
    <div className="mt-8 max-w-2xl">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="mb-1 flex w-full items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-subtle transition-colors hover:text-foreground"
      >
        <ChevronRightIcon
          className={cx("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")}
        />
        Completed
        <span className="font-normal text-subtle">{done.length}</span>
      </button>
      {expanded && (
        <div className="opacity-75">
          {done.map((t) => (
            <TaskRow key={t.id} task={t} onOpen={open} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Backlog with triage panel ─────────────────────────────────────────────────

// A triage card always offers a destination picker, pre-selected to the
// suggestion. Even a "no match" is one click from being filed, instead of the
// dead end a disabled Accept button used to be.
type TriageDest = { area_id: string | null; project_id: string | null };

function encodeDest(d: TriageDest): string {
  return d.project_id ? `p:${d.project_id}` : d.area_id ? `a:${d.area_id}` : "";
}
function decodeDest(v: string): TriageDest {
  if (v.startsWith("p:")) return { area_id: null, project_id: v.slice(2) };
  if (v.startsWith("a:")) return { area_id: v.slice(2), project_id: null };
  return { area_id: null, project_id: null };
}

function TriageCard({
  sug,
  onAccept,
  onReject,
}: {
  sug: TriageSuggestion;
  onAccept: (id: string, dest: TriageDest) => void;
  onReject: (id: string) => void;
}) {
  const { data: areas = [] } = useAreas();
  const { data: projects = [] } = useProjects();
  const [choice, setChoice] = useState(
    encodeDest({
      area_id: sug.suggested_area_id,
      project_id: sug.suggested_project_id,
    })
  );

  const confidenceCls =
    sug.confidence >= 0.5
      ? "text-success"
      : sug.confidence > 0
      ? "text-warning"
      : "text-subtle";

  return (
    <div className="rounded-lg border border-border bg-surface/60 p-3">
      <p className="mb-1 text-sm font-medium leading-snug">{sug.task_title}</p>
      <p className="mb-2 text-[11px]">
        <span className={confidenceCls}>
          {sug.confidence > 0 ? `${Math.round(sug.confidence * 100)}% match` : "no match"}
        </span>
        <span className="ml-2 text-subtle">{sug.reason}</span>
      </p>

      <select
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        className="mb-3 w-full rounded-md border border-input bg-surface px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary"
      >
        <option value="">Choose a destination…</option>
        {areas.map((a) => (
          <optgroup key={a.id} label={a.name}>
            <option value={`a:${a.id}`}>{a.name} (loose task)</option>
            {projects
              .filter((p) => p.area_id === a.id)
              .map((p) => (
                <option key={p.id} value={`p:${p.id}`}>
                  {a.name} › {p.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>

      <div className="flex gap-2">
        <Button
          variant="primary"
          className="h-7 px-3 text-xs"
          onClick={() => onAccept(sug.id, decodeDest(choice))}
          disabled={!choice}
        >
          Accept
        </Button>
        <Button
          variant="ghost"
          className="h-7 px-3 text-xs"
          onClick={() => onReject(sug.id)}
        >
          Skip
        </Button>
      </div>
    </div>
  );
}

function BacklogBody({ tasks, list }: { tasks: Task[]; list: ReactNode }) {
  const [triageOpen, setTriageOpen] = useState(false);
  const { data: suggestions = [], isLoading: loadingSugs } = useTriageSuggestions();
  const generate = useTriageGenerate();
  const accept = useTriageAccept();
  const reject = useTriageReject();

  const pending = suggestions.filter((s) => s.status === "pending");

  async function handleGenerate() {
    setTriageOpen(true);
    await generate.mutateAsync();
  }

  return (
    <div className="max-w-3xl">
      {/* From your notes (Obsidian extraction inbox) */}
      <NotesInbox />

      {/* Triage panel */}
      <div className="mb-5 rounded-xl border border-border bg-surface/40 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <span className="text-sm font-medium">AI Triage</span>
            <span className="ml-2 text-xs text-subtle">
              {tasks.length} task{tasks.length !== 1 ? "s" : ""} in backlog
            </span>
          </div>
          <Button
            variant="subtle"
            className="h-7 text-xs"
            onClick={handleGenerate}
            disabled={generate.isPending || tasks.length === 0}
          >
            {generate.isPending ? "Analysing…" : "Suggest placements"}
          </Button>
        </div>

        {triageOpen && (
          <>
            {loadingSugs && !pending.length ? (
              <p className="text-xs text-subtle">Loading suggestions…</p>
            ) : pending.length === 0 ? (
              <p className="text-xs text-subtle">
                {tasks.length === 0
                  ? "Backlog is empty."
                  : "No suggestions yet. Click «Suggest placements» to analyse."}
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {pending.map((s) => (
                  <TriageCard
                    key={s.id}
                    sug={s}
                    onAccept={(id, dest) => accept.mutate({ id, dest })}
                    onReject={(id) => reject.mutate(id)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {!triageOpen && tasks.length > 0 && (
          <p className="text-xs text-subtle">
            Keyword-match suggestions across your areas and projects.
            Claude can do deeper triage via MCP → <code>triage_backlog</code>.
          </p>
        )}
      </div>

      {/* Task list (grid/list + sort/group applied by ViewPage) */}
      {list}
    </div>
  );
}

// A project card on the area page plays two DnD roles at once:
//   - droppable: drag a loose task onto it to file the task into the project.
//   - draggable: drag the card itself onto another area (in the sidebar) to
//     move the whole project there.
// One <a> is both; the two dnd-kit refs are merged onto it. Click still
// navigates, because a drag only starts past the pointer-movement threshold.
function ProjectCard({ project }: { project: Project }) {
  // The sidebar already registers `project:<id>`; dnd-kit ids are global, so a
  // second droppable under that key would silently shadow one of the two.
  const drop = useDroppable({
    id: `area-card:project:${project.id}`,
    data: { type: "project", projectId: project.id, areaId: project.area_id },
  });
  const drag = useDraggable({
    id: `drag-project:${project.id}`,
    data: { type: "move-project", project },
  });
  // Open task count, shown quietly top-right so you can gauge a project at a
  // glance from the area view. useTasks(project_id) returns open tasks only.
  const { data: projectTasks = [] } = useTasks({ project_id: project.id });
  const openCount = projectTasks.length;
  const ref = (node: HTMLElement | null) => {
    drop.setNodeRef(node);
    drag.setNodeRef(node);
  };
  return (
    <a
      ref={ref}
      href={`/project/${project.id}`}
      {...drag.attributes}
      {...drag.listeners}
      className={cx(
        "relative touch-none rounded-lg border bg-surface p-3 transition-colors",
        drag.isDragging ? "cursor-grabbing opacity-40" : "cursor-grab",
        drop.isOver
          ? "border-primary ring-1 ring-primary/50"
          : "border-border hover:border-primary/40"
      )}
    >
      {openCount > 0 && (
        <span
          className="absolute right-2 top-2 text-xs tabular-nums text-subtle"
          title={`${openCount} open task${openCount === 1 ? "" : "s"}`}
        >
          {openCount}
        </span>
      )}
      <div className="pr-6 font-medium">{project.name}</div>
      {project.goal && <div className="pr-6 text-xs text-subtle">{project.goal}</div>}
      {drop.isOver && (
        <div className="mt-1 text-[11px] text-primary">Drop to file here</div>
      )}
    </a>
  );
}

export function AreaPage() {
  const { id = "" } = useParams();
  const { data: areas = [] } = useAreas();
  const { data: projects = [] } = useProjects(id);
  const { data: tasks = [] } = useTasks({ area_id: id });
  const area = areas.find((a) => a.id === id);
  const [editArea, setEditArea] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const AreaIcon = areaIcon(area?.icon);
  const { view, setView, controls, body, sortMenu, groupMenu, filterMenu } =
    useTaskCollection(`area:${id}`, tasks, "No loose tasks in this area.");

  return (
    <div>
      <Header
        title={area?.name ?? "Area"}
        icon={
          AreaIcon ? (
            <AreaIcon className={ICON_SIZE} style={{ color: areaColorVar(area?.color) }} />
          ) : (
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ background: areaColorVar(area?.color) }}
            />
          )
        }
        tabs={LIST_GRID_TABS}
        activeTab={view}
        onTab={setView}
        sort={sortMenu}
        group={groupMenu}
        filter={filterMenu}
        menu={[{ label: "Edit area", onSelect: () => setEditArea(true) }]}
      />
      {area && (
        <AreaDialog open={editArea} onOpenChange={setEditArea} existing={area} />
      )}
      <ProjectDialog open={newProject} onOpenChange={setNewProject} areaId={id} />

      <div className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-subtle">
            Projects
          </span>
          <button onClick={() => setNewProject(true)} className="text-sm text-primary">
            + New project
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
          {projects.length === 0 && (
            <p className="text-sm text-subtle">No projects yet.</p>
          )}
        </div>
      </div>

      <div className="mb-2 text-xs uppercase tracking-wide text-subtle">
        Loose tasks
      </div>
      <div className="mb-3 max-w-2xl">
        <QuickCapture defaultAreaId={id} />
      </div>
      {body}
      {view === "list" && <BulkActionBar controls={controls} />}
    </div>
  );
}

export function ProjectPage() {
  const { id = "" } = useParams();
  const { open } = useTaskUI();
  const { data: projects = [] } = useProjects();
  const { data: areas = [] } = useAreas();
  const { viewDefault, setViewDefault } = useViewPrefs();
  const vd = viewDefault(`project:${id}`);
  const view = (vd.mode ?? "grid") as ViewMode;
  const sort = (vd.sort as SortKey) ?? "manual";
  const filter = (vd.filter as FilterKey) ?? "all";
  const setView = (m: ViewMode) => setViewDefault(`project:${id}`, { mode: m });
  const [edit, setEdit] = useState(false);
  const project = projects.find((p) => p.id === id);
  if (!project) return <p className="text-subtle">Loading project...</p>;
  const parentArea = areas.find((a) => a.id === project.area_id);

  const sortMenu: MenuChoice[] = (Object.keys(SORT_LABEL) as SortKey[]).map((k) => ({
    label: SORT_LABEL[k],
    active: sort === k,
    onSelect: () => setViewDefault(`project:${id}`, { sort: k }),
  }));
  const filterMenu: MenuChoice[] = (Object.keys(FILTER_LABEL) as FilterKey[]).map((k) => ({
    label: FILTER_LABEL[k],
    active: filter === k,
    onSelect: () => setViewDefault(`project:${id}`, { filter: k }),
  }));

  return (
    <div>
      <Header
        title={project.name}
        tabs={LIST_GRID_TABS}
        activeTab={view}
        onTab={setView}
        sort={sortMenu}
        filter={filterMenu}
        menu={[{ label: "Edit project", onSelect: () => setEdit(true) }]}
        below={
          <div className="max-w-2xl space-y-2">
            {/* Projects are always reached through an area, so give the way back. */}
            {parentArea && (
              <a
                href={`/area/${parentArea.id}`}
                className="inline-flex items-center gap-1 text-xs text-subtle transition-colors hover:text-foreground"
              >
                <BackIcon className="h-3.5 w-3.5" />
                {parentArea.name}
              </a>
            )}
            <QuickCapture defaultProjectId={project.id} defaultAreaId={project.area_id} />
          </div>
        }
      />
      <ProjectDialog open={edit} onOpenChange={setEdit} existing={project} />
      <ProjectBoard
        project={project}
        view={view === "list" ? "list" : "grid"}
        onOpen={open}
        transform={(ts) => sortTasks(filterTasks(ts, filter), sort)}
      />
    </div>
  );
}

export function LabelPage() {
  const { name = "" } = useParams();
  const { data: tasks = [] } = useTasks({});
  const filtered = tasks.filter((t) =>
    (t.labels ?? []).some((l) => l.name === decodeURIComponent(name))
  );
  return (
    <div>
      <Header title={`@${decodeURIComponent(name)}`} />
      <TaskList tasks={filtered} empty="No tasks with this label." />
    </div>
  );
}

// ── Saved filter view ─────────────────────────────────────────────────────────

export function FilterPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { open } = useTaskUI();
  const { data: filters = [] } = useSavedFilters();
  const { data: tasks = [], isLoading } = useFilterTasks(id);
  const del = useDeleteFilter();
  const [editOpen, setEditOpen] = useState(false);

  const filter = filters.find((f) => f.id === id);
  const controls = useTaskSelection(tasks, open, true);

  return (
    <div>
      <Header
        title={filter?.name ?? "Filter"}
        icon={<FilterIcon className={ICON_SIZE} />}
        menu={[
          { label: "Edit filter", onSelect: () => setEditOpen(true) },
          {
            label: "Delete filter",
            onSelect: () => {
              if (confirm("Delete this filter?")) {
                del.mutate(id);
                navigate("/today");
              }
            },
          },
        ]}
      />
      {isLoading ? (
        <p className="px-2 text-sm text-subtle">Loading…</p>
      ) : (
        <TaskList tasks={tasks} empty="No tasks match this filter." controls={controls} />
      )}
      <BulkActionBar controls={controls} />
      <FilterDialog open={editOpen} onOpenChange={setEditOpen} existing={filter} />
    </div>
  );
}

// ── Weekly review ─────────────────────────────────────────────────────────────

export function ReviewPage() {
  const { data, isLoading } = useReview();

  return (
    <div className="max-w-3xl">
      <Header title="Weekly review" icon={<ReviewIcon className={ICON_SIZE} />} />

      {isLoading || !data ? (
        <p className="px-2 text-sm text-subtle">Loading…</p>
      ) : (
        <div className="space-y-6">
          <p className="text-xs text-subtle">
            {data.period.from} → {data.period.to}
          </p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ReviewStat value={data.stats.completed} label="Completed" tone="success" />
            <ReviewStat value={data.stats.slipped} label="Slipped" tone="danger" />
            <ReviewStat value={data.stats.upcoming} label="Next 7 days" tone="primary" />
            <ReviewStat value={data.stats.created} label="Created" tone="muted" />
          </div>

          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">
              Progress
            </h2>
            <StatsWidget />
          </section>

          {data.by_area.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">
                Completed by area
              </h2>
              <div className="space-y-1.5">
                {data.by_area.map((a) => {
                  const pct = Math.round(
                    (a.completed / Math.max(1, data.stats.completed)) * 100
                  );
                  return (
                    <div key={a.area} className="flex items-center gap-3 text-sm">
                      <span className="w-28 shrink-0 truncate text-muted">{a.area}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full bg-success"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-6 text-right tabular-nums text-subtle">
                        {a.completed}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <ReviewList
            title="Done this week"
            tasks={data.completed_tasks}
            empty="Nothing completed yet this week."
          />
          <ReviewList
            title="Slipped (overdue, still open)"
            tasks={data.slipped_tasks}
            empty="Nothing overdue. Nice."
            danger
          />
          <ReviewList
            title="Coming up (next 7 days)"
            tasks={data.upcoming_tasks}
            empty="Nothing scheduled in the next week."
          />
        </div>
      )}
    </div>
  );
}

function ReviewStat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "success" | "danger" | "primary" | "muted";
}) {
  const color =
    tone === "success"
      ? "text-success"
      : tone === "danger"
      ? "text-danger"
      : tone === "primary"
      ? "text-primary"
      : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-surface/60 p-3">
      <div className={cx("text-2xl font-semibold tabular-nums", color)}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-subtle">{label}</div>
    </div>
  );
}

function ReviewList({
  title,
  tasks,
  empty,
  danger,
}: {
  title: string;
  tasks: { id: string; title: string; due_date?: string | null }[];
  empty: string;
  danger?: boolean;
}) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">
        {title} <span className="text-subtle">{tasks.length}</span>
      </h2>
      {tasks.length === 0 ? (
        <p className="px-2 text-sm text-subtle">{empty}</p>
      ) : (
        <ul className="space-y-0.5">
          {tasks.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground"
            >
              <span className="flex-1 truncate">{t.title}</span>
              {t.due_date && (
                <span className={cx("text-[11px]", danger ? "text-danger" : "text-subtle")}>
                  {t.due_date}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Settings page ─────────────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-subtle">
        {title}
      </h2>
      <div className="rounded-xl border border-border bg-surface/40 p-5">
        {children}
      </div>
    </div>
  );
}

// Catch-all area for backlog tasks triage cannot confidently place. Without one,
// an unmatched ad-hoc task has no home and triage just shrugs.
function TriageSection() {
  const { data: areas = [] } = useAreas();
  const { prefs, setTriageFallbackArea } = useViewPrefs();
  const current = prefs.triageFallbackAreaId ?? "";

  return (
    <Section title="Triage">
      <label className="block text-sm text-foreground">
        Catch-all area
        <p className="mt-0.5 mb-2 text-xs text-subtle">
          When triage cannot confidently match a backlog task (an ad-hoc task, say),
          it suggests this area instead of giving up.
        </p>
        <select
          value={current}
          onChange={(e) => setTriageFallbackArea(e.target.value || null)}
          className="w-full max-w-sm rounded-md border border-input bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary"
        >
          <option value="">None (leave unmatched)</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
    </Section>
  );
}

// System / Light / Dark segmented control. Writes through useTheme (persists to
// localStorage + applies to the DOM immediately). "System" follows the OS.
// Small on/off switch, shared by the settings toggles.
function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-surface-2"
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

function AppearanceSection() {
  const { pref, resolved, setPref, palette, setPalette, font, setFont } = useTheme();
  const { dimDistantTasks, setDimDistantTasks } = useViewPrefs();
  const opts: { value: ThemePref; label: string }[] = [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];
  return (
    <Section title="Appearance">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm text-foreground">Mode</div>
          <div className="text-xs text-subtle">
            {pref === "system"
              ? `Following your system (${resolved})`
              : `Always ${pref}`}
          </div>
        </div>
        <div className="flex shrink-0 rounded-lg border border-border bg-surface-2/40 p-0.5">
          {opts.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setPref(o.value)}
              className={
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                (pref === o.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted hover:text-foreground")
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Colour scheme: recolours the whole page, works in light + dark. */}
      <div className="mt-4 border-t border-border pt-4">
        <div className="text-sm text-foreground">Colour scheme</div>
        <div className="text-xs text-subtle">
          Sets the accent colour. Applies on top of your light/dark mode.
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {PALETTES.map((p) => {
            const active = palette === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setPalette(p.key)}
                aria-label={p.label}
                aria-pressed={active}
                title={p.label}
                className={cx(
                  "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-colors",
                  active
                    ? "border-primary bg-surface-2 text-foreground"
                    : "border-border text-muted hover:text-foreground"
                )}
              >
                <span
                  className="h-4 w-4 shrink-0 rounded-full"
                  style={{ background: p.swatch }}
                />
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Font: system stacks only, so it stays offline-safe. */}
      <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
        <div className="min-w-0">
          <div className="text-sm text-foreground">Font</div>
          <div className="text-xs text-subtle">The typeface used across the app.</div>
        </div>
        <div className="flex shrink-0 rounded-lg border border-border bg-surface-2/40 p-0.5">
          {FONTS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFont(f.key)}
              className={
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                (font === f.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted hover:text-foreground")
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
        <div className="min-w-0">
          <div className="text-sm text-foreground">Dim distant tasks</div>
          <div className="text-xs text-subtle">
            Grey out tasks due more than a month away. They stay fully usable, just
            quieter, so the far future doesn&apos;t pull your eye.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={dimDistantTasks}
          aria-label="Dim distant tasks"
          onClick={() => setDimDistantTasks(!dimDistantTasks)}
          className={cx(
            "relative h-6 w-11 shrink-0 rounded-full transition-colors",
            dimDistantTasks ? "bg-primary" : "bg-surface-2"
          )}
        >
          <span
            className={cx(
              "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
              dimDistantTasks ? "translate-x-[22px]" : "translate-x-0.5"
            )}
          />
        </button>
      </div>
    </Section>
  );
}

export function SettingsPage() {
  const me = useMe();
  const { data: pushStatus, refetch: refetchPush } = usePushStatus();
  const { data: cal, refetch: refetchCal } = useCalendarStatus();
  const { data: calFeeds } = useCalendarFeeds(!!cal?.connected);
  const setCalFeed = useSetCalendarFeed();
  const { gcalSyncTimeBlocks, gcalSyncDueDates, setGcalSync } = useViewPrefs();
  const { data: gmail, refetch: refetchGmail } = useGmailStatus();
  const gmailRefresh = useGmailRefresh();
  const [gmailBusy, setGmailBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [mcpToken, setMcpToken] = useState<string | null>(null);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [calBusy, setCalBusy] = useState(false);

  const swReady = "serviceWorker" in navigator;

  async function disconnectCal() {
    if (!confirm("Disconnect Google Calendar? Synced events will be cleared."))
      return;
    setCalBusy(true);
    try {
      await api.calendarDisconnect();
      await refetchCal();
    } finally {
      setCalBusy(false);
    }
  }

  async function disconnectGmail() {
    if (!confirm("Disconnect Gmail? Coverage rows already recorded are kept."))
      return;
    setGmailBusy(true);
    try {
      await api.gmailDisconnect();
      await refetchGmail();
    } finally {
      setGmailBusy(false);
    }
  }

  async function revealToken() {
    setTokenBusy(true);
    try {
      const { token } = await api.mcpToken();
      setMcpToken(token);
    } finally {
      setTokenBusy(false);
    }
  }

  async function rotateToken() {
    if (!confirm("Rotate your MCP token? The old one stops working immediately."))
      return;
    setTokenBusy(true);
    try {
      const { token } = await api.mcpTokenRotate();
      setMcpToken(token);
    } finally {
      setTokenBusy(false);
    }
  }

  async function enablePush() {
    if (!swReady) return;
    setPushBusy(true);
    setPushError(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setPushError("Notification permission denied.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const { key } = await api.pushVapidKey();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      const json = sub.toJSON();
      await api.pushSubscribe({
        endpoint: json.endpoint!,
        keys: json.keys as { p256dh: string; auth: string },
      });
      await refetchPush();
    } catch (e) {
      setPushError(String(e));
    } finally {
      setPushBusy(false);
    }
  }

  async function disablePush() {
    if (!swReady) return;
    setPushBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.pushUnsubscribe(sub.endpoint);
        await sub.unsubscribe();
      }
      await refetchPush();
    } catch (e) {
      setPushError(String(e));
    } finally {
      setPushBusy(false);
    }
  }

  const isSubscribed = (pushStatus?.subscriptions ?? 0) > 0;

  return (
    <div className="max-w-xl">
      <Header title="Settings" />

      <InstallHint dismissible={false} />

      <Section title="Account">
        <div className="flex items-center gap-3">
          {me?.avatar ? (
            <img
              src={me.avatar}
              alt=""
              className="h-10 w-10 rounded-full"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-sm font-medium text-foreground">
              {(me?.name || me?.email || "?").trim().charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm text-foreground">
              {me?.name ?? "Signed in"}
            </div>
            <div className="truncate text-xs text-subtle">{me?.email}</div>
          </div>
        </div>
      </Section>

      <AppearanceSection />

      <TriageSection />

      <Section title="Notifications">
        {!swReady ? (
          <p className="text-sm text-muted">
            Service workers not supported in this browser.
          </p>
        ) : !pushStatus?.configured ? (
          <p className="text-sm text-muted">
            Push not configured. Run{" "}
            <code className="rounded bg-surface-2 px-1 text-[12px]">
              node scripts/gen-vapid.mjs
            </code>{" "}
            and set{" "}
            <code className="rounded bg-surface-2 px-1 text-[12px]">VAPID_PUBLIC_KEY</code> +{" "}
            <code className="rounded bg-surface-2 px-1 text-[12px]">VAPID_PRIVATE_KEY_JWK</code>{" "}
            as wrangler secrets.
          </p>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground">
                Morning brief push{" "}
                <span
                  className={cx(
                    "font-medium",
                    isSubscribed ? "text-success" : "text-subtle"
                  )}
                >
                  {isSubscribed ? "enabled" : "disabled"}
                </span>
              </p>
              <p className="text-xs text-subtle">Delivered at 06:00 Brussels time</p>
              {pushError && <p className="mt-1 text-xs text-danger">{pushError}</p>}
            </div>
            <Button
              variant={isSubscribed ? "ghost" : "primary"}
              className="h-8 text-xs"
              disabled={pushBusy}
              onClick={isSubscribed ? disablePush : enablePush}
            >
              {pushBusy ? "…" : isSubscribed ? "Disable" : "Enable"}
            </Button>
          </div>
        )}
      </Section>

      <Section title="Google Calendar">
        {cal && (
          <div className="mb-4 empty:mb-0">
            <CalendarSyncBanner status={cal} />
          </div>
        )}
        {cal?.connected ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">
                Connected <span className="text-subtle">· {cal.google_email}</span>
              </p>
              <p className="text-xs text-subtle">
                Two-way task sync, and all your calendars shown as a backdrop.
                Reconnect if your other calendars aren't appearing.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="subtle"
                className="h-8 text-xs"
                onClick={() => {
                  window.location.href = "/calendar";
                }}
              >
                Open
              </Button>
              <Button
                variant="subtle"
                className="h-8 text-xs"
                onClick={() => {
                  window.location.href = "/api/calendar/connect";
                }}
              >
                Reconnect
              </Button>
              <Button
                variant="ghost"
                className="h-8 text-xs text-danger hover:bg-danger/10"
                disabled={calBusy}
                onClick={disconnectCal}
              >
                {calBusy ? "…" : "Disconnect"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted">
              Connect to see meetings as a backdrop and drag tasks onto a timeline.
            </p>
            <Button
              variant="primary"
              className="h-8 shrink-0 text-xs"
              onClick={() => {
                window.location.href = "/api/calendar/connect";
              }}
            >
              Connect
            </Button>
          </div>
        )}

        {/* Which calendars show up on the grid. */}
        {cal?.connected && calFeeds && calFeeds.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-border pt-4">
            <div className="text-sm text-foreground">Calendars to show</div>
            <div className="text-xs text-subtle">
              Pick which Google calendars appear as a backdrop on the timeline.
            </div>
            <div className="mt-1 space-y-1.5">
              {calFeeds.map((f) => (
                <div
                  key={f.calendar_id}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: f.color ?? "var(--muted)" }}
                    />
                    <span className="truncate text-sm text-foreground">
                      {f.summary ?? f.calendar_id}
                    </span>
                    {f.primary && (
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-subtle">
                        primary
                      </span>
                    )}
                  </div>
                  <Switch
                    label={`Show ${f.summary ?? f.calendar_id}`}
                    checked={f.enabled}
                    disabled={f.primary || setCalFeed.isPending}
                    onChange={(v) =>
                      setCalFeed.mutate({ id: f.calendar_id, enabled: v })
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* What Checkbox pushes to Google Calendar. */}
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm text-foreground">Sync time-blocked tasks</div>
              <div className="text-xs text-subtle">
                Tasks you give a time block show as timed events.
              </div>
            </div>
            <Switch
              label="Sync time-blocked tasks"
              checked={gcalSyncTimeBlocks}
              onChange={(v) => setGcalSync({ gcalSyncTimeBlocks: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm text-foreground">Sync due-dated tasks</div>
              <div className="text-xs text-subtle">
                Tasks with a due date show as all-day events. Turn off to keep due
                dates in Checkbox only and declutter your calendar.
              </div>
            </div>
            <Switch
              label="Sync due-dated tasks"
              checked={gcalSyncDueDates}
              onChange={(v) => setGcalSync({ gcalSyncDueDates: v })}
            />
          </div>
          <p className="text-[11px] text-subtle">
            Takes effect as tasks are next created or edited; existing events
            reconcile on the next sync.
          </p>
        </div>
      </Section>

      <Section title="Gmail">
        {gmail?.sync_broken && gmail.last_error && (
          <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 p-2.5 text-xs text-danger">
            Gmail sync is broken. Reconnect. <span className="opacity-70">{gmail.last_error}</span>
          </div>
        )}
        {gmail?.connected ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">
                Connected <span className="text-subtle">· {gmail.google_email}</span>
              </p>
              <p className="text-xs text-subtle">
                Live coverage pull.{" "}
                {gmail.last_sync_at
                  ? `Last refreshed ${gmail.last_sync_at.slice(0, 16).replace("T", " ")}`
                  : "Not refreshed yet"}
                .
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="subtle"
                className="h-8 text-xs"
                disabled={gmailRefresh.isPending}
                onClick={() => gmailRefresh.mutate()}
              >
                {gmailRefresh.isPending ? "Refreshing…" : "Refresh now"}
              </Button>
              <Button
                variant="ghost"
                className="h-8 text-xs text-danger hover:bg-danger/10"
                disabled={gmailBusy}
                onClick={disconnectGmail}
              >
                {gmailBusy ? "…" : "Disconnect"}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted">
                Connect Gmail to refresh Mail coverage live, instead of waiting for
                the planner&apos;s next run. Checkbox never sends mail.
              </p>
              <Button
                variant="primary"
                className="h-8 shrink-0 text-xs"
                onClick={() => {
                  window.location.href = "/api/gmail/connect";
                }}
              >
                Connect
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-subtle">
              One-time Google Cloud setup: add the scope{" "}
              <code className="rounded bg-surface-2 px-1">gmail.modify</code> to your
              OAuth consent screen, and add{" "}
              <code className="rounded bg-surface-2 px-1">
                {location.origin}/api/gmail/callback
              </code>{" "}
              as an authorised redirect URI.
            </p>
          </div>
        )}
      </Section>

      <Section title="Integrations">
        <p className="mb-2 text-sm text-foreground">
          Add Checkbox to Claude&apos;s MCP settings to use it from chat. This token
          is yours alone, it identifies your account.
        </p>
        <div className="space-y-2 text-xs">
          <div>
            <span className="text-subtle">URL</span>
            <code className="ml-2 rounded bg-surface-2 px-2 py-0.5 text-foreground">
              {location.origin}/mcp
            </code>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-subtle">Token</span>
            {mcpToken ? (
              <code className="break-all rounded bg-surface-2 px-2 py-0.5 text-foreground">
                {mcpToken}
              </code>
            ) : (
              <button
                onClick={revealToken}
                className="rounded bg-surface-2 px-2 py-0.5 text-primary hover:bg-surface-2/70"
              >
                {tokenBusy ? "…" : "Reveal my token"}
              </button>
            )}
            {mcpToken && (
              <button
                onClick={rotateToken}
                className="rounded px-2 py-0.5 text-subtle hover:text-foreground"
                title="Rotate: invalidates the old token"
              >
                {tokenBusy ? "…" : "rotate"}
              </button>
            )}
          </div>
        </div>
        <p className="mt-3 text-xs text-subtle">
          16 tools: task CRUD, triage, plan-my-day, daily brief, weekly review.
        </p>
      </Section>
    </div>
  );
}
