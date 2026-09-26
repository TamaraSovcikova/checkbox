import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { api } from "./lib/api";
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
  useSavedFilters,
  useFilterTasks,
  useDeleteFilter,
} from "./lib/queries";
import { FilterDialog } from "./components/FilterDialog";
import { AreaDialog } from "./components/AreaDialog";
import { ProjectDialog } from "./components/ProjectDialog";
import { SuggestToday } from "./components/SuggestToday";
import { CapacityLine } from "./components/CapacityLine";
import { RenegotiateLink } from "./components/RenegotiateLink";
import { PinsStrip, PinsSide, useAddPin, useSidePins } from "./components/Pins";
import { scopeForView, scopeForArea } from "./lib/pinScope";
import { CheatSheet } from "./components/CheatSheet";
import { StalePlanNudge } from "./components/StalePlanNudge";
import { NotesInbox } from "./components/NotesInbox";
import { InstallHint } from "./components/InstallHint";
import { FilterIcon, SnoozeIcon, RepeatIcon } from "./lib/icons";
import { isRecurring, isDormant, splitDormantRecurring } from "./lib/recurring";
import { areaColorVar } from "./lib/colors";
import { areaIcon } from "./lib/icons";
import { useTaskUI } from "./lib/ui-context";
import { QuickCapture } from "./components/QuickCapture";
import { ProjectBoard } from "./components/ProjectBoard";
import { ProjectFlow } from "./components/ProjectFlow";
import { TodayBoard } from "./components/TodayBoard";
import { TaskRow } from "./components/TaskRow";
import {
  useTaskSelection,
  BulkActionBar,
  type TaskControls,
} from "./components/TaskListControls";
import { type Tab, type MenuChoice } from "./components/TopBar";
import { Header } from "./components/PageHeader";
import {
  ListIcon,
  BoardIcon,
  FlowIcon,
  TodayIcon,
  UpcomingIcon,
  OverdueIcon,
  BacklogIcon,
  WheneverIcon,
  ParkIcon,
  LogbookIcon,
  ChevronRightIcon,
  BackIcon,
  ICON_SIZE,
} from "./lib/icons";
import { useViewPrefs } from "./lib/queries";
import { Button, cx } from "./components/ui";
import { todayStr } from "./lib/utils";
import type { ComponentType, ReactNode } from "react";


function TaskList({
  tasks,
  empty,
  controls,
  indexOffset = 0,
  tintArea = true,
  showCode = false,
}: {
  tasks: Task[];
  empty: string;
  controls?: TaskControls;
  indexOffset?: number;
  tintArea?: boolean;
  showCode?: boolean;
}) {
  const { open } = useTaskUI();
  if (tasks.length === 0)
    return <p className="px-2 text-sm text-subtle">{empty}</p>;
  return (
    // space-y gives rows room to breathe; packed rows were hard to scan.
    //
    // No width cap: the rows fill their column, so dragging the rail divider
    // actually moves space between the two. It used to stop at max-w-2xl (672px),
    // which meant narrowing the rail freed room that nothing took, and the slider
    // looked like it only resized the calendar.
    <div className="space-y-1">
      {tasks.map((t, i) => (
        <TaskRow
          key={t.id}
          task={t}
          onOpen={open}
          selection={controls?.rowFor(t, indexOffset + i)}
          tintArea={tintArea}
          showCode={showCode}
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
  parked: {
    title: "Parked",
    empty:
      "Nothing parked. Park a task to set it aside indefinitely: it leaves every list until you bring it back.",
    icon: ParkIcon,
  },
  whenever: {
    title: "Whenever",
    empty:
      "Nothing here yet. Mark a task Whenever when you mean to do it but it will never have a deadline. Mark it Optional as well for the ones you might never get to.",
    icon: WheneverIcon,
  },
  logbook: { title: "Logbook", empty: "No completed tasks yet.", icon: LogbookIcon },
  snoozed: {
    title: "Snoozed",
    empty: "Nothing snoozed. Snooze a task to defer it here.",
    icon: SnoozeIcon,
  },
};

// ── Client-side sort / group over the fetched task list ───────────────────────

type SortKey = "manual" | "priority" | "due" | "title" | "created" | "code";
// "commitment" splits a list by whether each task is something you have taken
// on or something you might never get to (the `optional` flag). It is the axis
// the Whenever view needs and it is not specific to that view: any list can
// usefully separate what you are actually doing from what you are merely
// keeping. See the Whenever default below.
type GroupKey = "none" | "due" | "priority" | "area" | "project" | "commitment";

const SORT_LABEL: Record<SortKey, string> = {
  manual: "Manual",
  priority: "Priority",
  due: "Due date",
  title: "Title",
  created: "Date created",
  // Codes are handed out in creation order, so this is "oldest first" with a
  // number you can read. Its own option because "sort by CB number" is what she
  // will think when she is working from a list of codes an agent gave her.
  code: "Code",
};

const GROUP_LABEL: Record<GroupKey, string> = {
  none: "None",
  due: "Due",
  priority: "Priority",
  area: "Area",
  project: "Project",
  commitment: "Taking on / someday",
};

// Ordered, not alphabetical: what you are doing comes before what you might
// never do, which is the whole point of separating them.
const COMMITMENT_ORDER = ["Taking these on", "Someday, maybe"];

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
    case "code":
      // Ascending, unlike created: CB-1 first reads as counting up, and a list
      // of codes to work through goes in the order they were given.
      return arr.sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity));
    default:
      return arr.sort((a, b) => a.position - b.position);
  }
}

export function groupTasks(
  tasks: Task[],
  key: GroupKey,
  names: { area: (id: string | null) => string; project: (id: string | null) => string }
): { label: string; tasks: Task[] }[] {
  if (key === "none") return [{ label: "", tasks }];

  // Two fixed sections in a fixed order, for the same reason Due has fixed
  // buckets: alphabetical would put "Someday" first, which is backwards.
  if (key === "commitment") {
    const groups = new Map<string, Task[]>();
    for (const t of tasks) {
      const label = t.optional ? COMMITMENT_ORDER[1] : COMMITMENT_ORDER[0];
      (groups.get(label) ?? groups.set(label, []).get(label)!).push(t);
    }
    return COMMITMENT_ORDER.filter((l) => groups.has(l)).map((label) => ({
      label,
      tasks: groups.get(label)!,
    }));
  }

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
function useTaskCollection(
  prefsKey: string,
  tasks: Task[],
  empty: string,
  // Area/project pages set this false: every row there shares one area colour, so
  // tinting them all says nothing and just makes the list heavy.
  tintArea = true,
  // Whether this list is the one on screen, for pages whose own tab decides it
  // (a project opens on its board). Keyboard selection only runs for a visible
  // list. Defaults to this hook's own stored view mode.
  listShown?: boolean
) {
  const { data: areas = [] } = useAreas();
  const { data: projects = [] } = useProjects();
  const { viewDefault, setViewDefault } = useViewPrefs();
  const { open } = useTaskUI();

  const vd = viewDefault(prefsKey);
  // "grid" was a card-grid mode that has been removed. Stored prefs still carry
  // it for anything last left in that mode, so it reads as list rather than
  // rendering nothing. Mapped on READ, so no prefs migration is needed and the
  // change stays reversible.
  const view = (vd.mode === "grid" ? "list" : vd.mode ?? "list") as ViewMode;
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

  // Selection + keyboard nav run over the flattened, grouped order. The running
  // offset keeps each group's rows in one continuous cursor sequence.
  const flat = groups.flatMap((g) => g.tasks);
  const controls = useTaskSelection(flat, open, listShown ?? view === "list");

  function renderBody(list: Task[], offset: number) {
    return (
      <TaskList
        tasks={list}
        empty={empty}
        controls={controls}
        indexOffset={offset}
        tintArea={tintArea}
        // The code earns a slot on the row exactly when it is what the list is
        // ordered by. Everywhere else it would be a number on 400 rows that she
        // is not currently using.
        showCode={sort === "code"}
      />
    );
  }

  let running = 0;
  // The keyboard's complete shortcut lives in the controls hook, so its
  // unfinished-subtasks question renders here with the list it belongs to.
  const inner =
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

  const body = (
    <>
      {inner}
      {controls.dialog}
    </>
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

// The card grid is gone: it said less per row than the list, took more space,
// and supported neither multi-select nor keyboard nav. Note that a PROJECT's old
// "Grid" tab was never this component - it draws the kanban board, and is now
// labelled as such.
type ViewMode = "list" | "board" | "recurring" | "flow";

const LIST_TAB: Tab<ViewMode> = {
  id: "list",
  label: "List",
  icon: <ListIcon className={ICON_SIZE} />,
};
const BOARD_TAB: Tab<ViewMode> = {
  id: "board",
  label: "Board",
  icon: <BoardIcon className={ICON_SIZE} />,
};
// Areas also offer a Recurring tab: the routines filed there, out of the way of
// the list until one is actually due. See lib/recurring.
const AREA_TABS: Tab<ViewMode>[] = [
  LIST_TAB,
  { id: "recurring", label: "Recurring", icon: <RepeatIcon className={ICON_SIZE} /> },
];
// Today also offers a To do / Doing / Done board you can drag between.
const TODAY_TABS: Tab<ViewMode>[] = [LIST_TAB, BOARD_TAB];

// Whenever holds two claims, and they are two separate browsing sessions rather
// than one list: "what could I pick up in this free hour" and "what might I one
// day do". It shipped as two stacked sections, which reads well and scrolls
// badly. Her report: "with many tasks it's quite hard to reach the Someday,
// maybe tasks."
//
// TABS rather than collapsing the lower section, because collapsing does not
// actually fix it: the collapsed header would still sit underneath everything
// you were scrolling past. Tabs put both at the top, always one click away,
// whatever the counts are. It is also the move the area page already makes for
// exactly this shape of problem (dormant routines in their own tab).
type WheneverTab = "taking" | "someday";
// A project's three shapes. Board first: it is the one worth defaulting to.
// Flow is the read-only dependency map (metro rendering, see ProjectFlow).
const PROJECT_TABS: Tab<ViewMode>[] = [
  BOARD_TAB,
  LIST_TAB,
  { id: "flow", label: "Flow", icon: <FlowIcon className={ICON_SIZE} /> },
];

// The right rail: the day timeline and that view's pins, sharing ONE slot.
//
// They used to stack, and that was the whole problem: switching the calendar on
// pushed the pins ~1200px below the fold and took the page to nearly three
// screens (measured: 1867px of content in a 682px viewport). Tabs mean turning
// the calendar on costs you nothing you had before.
//
// Sticky and height-bounded, so whatever is inside scrolls WITHIN the rail
// instead of extending the page. A tall stack of pins can no longer decide how
// long the document is.
//
// The tab bar only appears when there are genuinely two panes; one pane draws
// itself, unlabelled, exactly as before.
//
// The rail's WIDTH is draggable: grab the divider on its left edge and the space
// moves between the board and the rail. Persisted per view, because how much room
// the calendar deserves is not the same question on Today as on an area.

const RAIL_DEFAULT = 288; // matches the old fixed w-72
const RAIL_MIN = 220; // narrower than this and the timeline stops being readable
const RAIL_MAX = 560;
const clampRail = (n: number) => Math.max(RAIL_MIN, Math.min(RAIL_MAX, Math.round(n)));

function SideRail({
  scope,
  viewKey,
}: {
  scope: string;
  viewKey: string;
}) {
  const { viewDefault, setViewDefault } = useViewPrefs();
  const sidePins = useSidePins(scope);
  const hasPins = sidePins.length > 0;
  const def = viewDefault(viewKey);
  // Live width while dragging, so the pointer move does not write a pref per
  // pixel; the committed value lands once on release.
  const [dragW, setDragW] = useState<number | null>(null);
  const width = dragW ?? clampRail(def.railWidth ?? RAIL_DEFAULT);

  function onDividerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = width;
    let next = startW;

    const move = (ev: PointerEvent) => {
      // Dragging LEFT grows the rail, which is the direction the divider moves.
      next = clampRail(startW - (ev.clientX - startX));
      setDragW(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragW(null);
      if (next !== (def.railWidth ?? RAIL_DEFAULT)) {
        setViewDefault(viewKey, { railWidth: next });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // The day pane (timeline + cadences) moved to the Home dashboard, where both
  // exist as widgets; the rail is now the cards pane alone.
  if (!hasPins) return null;

  return (
    <>
      {/* The divider. Desktop only, since the rail stacks below on mobile and
          there is no boundary to drag. Invisible until you approach it: a
          permanent vertical rule between two panes is just a line to look at.
          The hit area is deliberately wider than the visible bar so it is
          grabbable without precision aiming. */}
      <div
        role="separator"
        aria-label="Resize rail"
        aria-orientation="vertical"
        title="Drag to resize"
        onPointerDown={onDividerDown}
        onDoubleClick={() => setViewDefault(viewKey, { railWidth: RAIL_DEFAULT })}
        className="group/div relative hidden w-2 shrink-0 cursor-col-resize lg:block"
      >
        <div
          className={cn(
            "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 rounded transition-colors",
            dragW != null ? "bg-primary" : "bg-transparent group-hover/div:bg-primary/40"
          )}
        />
      </div>
      <aside
        style={{ ["--rail-w" as string]: `${width}px` }}
        className="mt-4 lg:mt-0 lg:w-[var(--rail-w)] lg:shrink-0 lg:self-start lg:sticky lg:top-0 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto"
      >
      <PinsSide scope={scope} inline />
      </aside>
    </>
  );
}

export function ViewPage({ name }: { name: string }) {
  const { data: tasks = [] } = useView(name);
  // Which half of Whenever is showing. Local, not a stored preference: the page
  // should open on what she is actually working through, every time, rather
  // than on wherever she happened to leave it.
  const [wheneverTab, setWheneverTab] = useState<WheneverTab>("taking");
  // Today's board keeps a Done column, which the Today view (open tasks only)
  // can't fill, so pull today's completed tasks alongside. Cheap + cached.
  const { data: completedToday = [] } = useView("completed-today");
  const meta = VIEW_META[name];
  const { hide } = useViewPrefs();

  // Whenever is split by whether she has taken the task on (`optional` = might
  // never). The split is by TAB rather than by section heading now; see
  // WheneverTab. Everything else on the page is unchanged, so the tabs get the
  // full sort/group/filter/multi-select machinery rather than a reduced list.
  const isWhenever = name === "whenever";
  const takingOn = isWhenever ? tasks.filter((t) => !t.optional) : [];
  const someday = isWhenever ? tasks.filter((t) => !!t.optional) : [];
  const listed = isWhenever
    ? wheneverTab === "someday"
      ? someday
      : takingOn
    : tasks;
  const wheneverTabs: Tab<WheneverTab>[] = [
    {
      id: "taking",
      // Counted on the tab: the reason to look at the other one is usually
      // "how much is over there", and that should not need a click.
      label: `Taking on${takingOn.length ? ` · ${takingOn.length}` : ""}`,
      icon: <WheneverIcon className={ICON_SIZE} />,
    },
    {
      id: "someday",
      label: `Someday${someday.length ? ` · ${someday.length}` : ""}`,
      icon: <SnoozeIcon className={ICON_SIZE} />,
    },
  ];
  const emptyFor = isWhenever
    ? wheneverTab === "someday"
      ? "Nothing on the maybe pile. Mark a Whenever task Optional to park it here."
      : "Nothing you are actively picking up. Whenever tasks with no deadline land here."
    : meta.empty;

  const { view, setView, controls, body, sortMenu, groupMenu, filterMenu } =
    useTaskCollection(`/${name}`, listed, emptyFor);
  const isToday = name === "today";
  const showBoard = isToday && view === "board";
  const pinScope = scopeForView(name);
  // Make a card WHERE you are: no trip through the Cards page. Same pattern
  // the area pages already had.
  const addPin = useAddPin(pinScope);

  return (
    <div>
      <Header
        title={meta.title}
        icon={<meta.icon className={ICON_SIZE} />}
        // Only Today has a second shape. Everywhere else a lone "List" tab is
        // just a label pretending to be a control, so show no tab bar at all.
        tabs={
          isToday
            ? TODAY_TABS
            : isWhenever
            ? (wheneverTabs as unknown as Tab<ViewMode>[])
            : undefined
        }
        activeTab={isWhenever ? (wheneverTab as unknown as ViewMode) : view}
        onTab={
          isWhenever
            ? (t: string) => setWheneverTab(t as WheneverTab)
            : (setView as (t: string) => void)
        }
        sort={sortMenu}
        group={groupMenu}
        filter={filterMenu}
        menu={[
          { label: "New list card", onSelect: addPin.addList },
          { label: "New text card", onSelect: addPin.addNote },
          { label: "Hide this view", onSelect: () => hide(`/${name}`) },
        ]}
        below={
          name !== "logbook" ? (
            // Full width, matching the list below it: a capture bar that stopped
            // short of the rows it feeds looked like a stray element.
            <div>
              {/* Captured on Today -> planned for today, not dumped in Backlog. */}
              <QuickCapture
                defaultPlannedDate={name === "today" ? todayStr() : undefined}
              />
            </div>
          ) : undefined
        }
      />
      {/* Every view lays out as main column + rail, because any view can now carry
          pins (scoped to it), not just Today. */}
      <div className="lg:flex lg:gap-5">
        <div className="min-w-0 lg:flex-1">
          {isToday && <InstallHint />}
          <PinsStrip scope={pinScope} />
          {isToday && <CheatSheet />}
          {isToday && <StalePlanNudge tasks={tasks} />}
          {isToday && <SuggestToday />}
          {isToday && <CapacityLine tasks={tasks} />}
          {name === "overdue" && <RenegotiateLink count={tasks.length} />}
          {isToday && showBoard ? (
            // The board's Done column already shows today's completed tasks, so
            // the separate CompletedToday strip is redundant here.
            <TodayBoard open={tasks} done={completedToday} />
          ) : (
            <>
              {name === "backlog" ? <BacklogBody tasks={tasks} list={body} /> : body}
              {view === "list" && <BulkActionBar controls={controls} />}
              {isToday && <CompletedToday />}
            </>
          )}
        </div>
        <SideRail scope={pinScope} viewKey={`/${name}`} />
      </div>
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
    <div className="mt-8">
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

      {/* Triage. Closed it is one quiet line, so the backlog's tasks lead the
          page; the panel only appears once suggestions are asked for. */}
      {!triageOpen ? (
        <div className="mb-4 flex items-center gap-2 px-1 text-xs text-subtle">
          <span>
            AI Triage: {tasks.length} task{tasks.length !== 1 ? "s" : ""} in backlog.
          </span>
          <button
            onClick={handleGenerate}
            disabled={generate.isPending || tasks.length === 0}
            className="text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generate.isPending ? "Analysing…" : "Suggest placements"}
          </button>
        </div>
      ) : (
        <div className="mb-5 rounded-xl border border-border bg-surface/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <span className="text-sm font-medium">AI Triage</span>
              <span className="ml-2 text-xs text-subtle">
                {tasks.length} task{tasks.length !== 1 ? "s" : ""} in backlog
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="subtle"
                className="h-7 text-xs"
                onClick={handleGenerate}
                disabled={generate.isPending || tasks.length === 0}
              >
                {generate.isPending ? "Analysing…" : "Suggest placements"}
              </Button>
              <button
                onClick={() => setTriageOpen(false)}
                className="text-xs text-subtle hover:text-foreground"
              >
                close
              </button>
            </div>
          </div>

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
        </div>
      )}

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

// The area's routines: every recurring task filed here, dormant or live, with its
// cadence and when it next comes round. The list/grid tabs show the work of now;
// this shows the shape of the week.
function RecurringPanel({ tasks, today }: { tasks: Task[]; today: string }) {
  const { open } = useTaskUI();
  const recurring = tasks.filter(isRecurring);

  if (recurring.length === 0) {
    return (
      <p className="max-w-2xl rounded-xl border border-border bg-surface/40 p-6 text-center text-sm text-subtle">
        No recurring tasks in this area. Capture one with a cadence (&ldquo;water the plants
        every monday&rdquo;) and it will wait here until it is due.
      </p>
    );
  }

  // Live ones first: those are the ones asking for something today.
  const live = recurring.filter((t) => !isDormant(t, today));
  const dormant = recurring.filter((t) => isDormant(t, today));

  return (
    <div className="max-w-2xl space-y-4">
      {live.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle">
            Due now
            <span className="ml-2 rounded-full bg-surface-2 px-1.5 text-[11px] font-normal tabular-nums text-muted">
              {live.length}
            </span>
          </h3>
          <div className="space-y-1">
            {live.map((t) => (
              <TaskRow key={t.id} task={t} onOpen={open} tintArea={false} />
            ))}
          </div>
        </section>
      )}
      <section>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle">
          Waiting
          <span className="ml-2 rounded-full bg-surface-2 px-1.5 text-[11px] font-normal tabular-nums text-muted">
            {dormant.length}
          </span>
        </h3>
        {dormant.length === 0 ? (
          <p className="text-xs text-subtle">Nothing waiting: every routine here is due.</p>
        ) : (
          <div className="space-y-1">
            {dormant.map((t) => (
              <TaskRow key={t.id} task={t} onOpen={open} tintArea={false} />
            ))}
          </div>
        )}
      </section>
    </div>
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
  const addPin = useAddPin(scopeForArea(id));

  // Routines that are not due yet come out of the list and live in the Recurring
  // tab instead. A recurring task that IS due stays put: at that point it is work
  // like any other, and tucking it away is how you would miss it.
  const today = todayStr();
  const { active, dormant } = splitDormantRecurring(tasks, today);

  const { view, setView, controls, body, sortMenu, groupMenu, filterMenu } =
    useTaskCollection(`area:${id}`, active, "No loose tasks in this area.", false);
  const showRecurring = view === "recurring";

  return (
    // The area's own theme is scoped to this subtree via [data-palette] (see the
    // descendant palette selectors in index.css), so the sidebar and the rest of
    // the app keep the global theme. Painting --background here is what makes the
    // page read as themed rather than as themed cards on the app's background.
    <div
      data-palette={area?.palette ?? undefined}
      style={area?.palette ? { background: "var(--background)" } : undefined}
      className={cn(area?.palette && "-mx-4 -mt-4 px-4 pt-4 md:-mx-6 md:-mt-6 md:px-6 md:pt-6")}
    >
      {area?.banner && (
        <div className="mb-4 overflow-hidden rounded-xl border border-border">
          <img
            src={area.banner}
            alt=""
            className="h-28 w-full object-cover md:h-36"
            // A pasted link can rot or 404; drop the frame rather than leave a
            // broken-image icon sitting at the top of the page.
            onError={(e) => {
              e.currentTarget.parentElement?.remove();
            }}
          />
        </div>
      )}
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
        tabs={AREA_TABS}
        activeTab={view}
        onTab={setView}
        // Sort/group/filter drive the task collection, which the Recurring tab
        // does not use, so they would be dead controls there.
        sort={showRecurring ? undefined : sortMenu}
        group={showRecurring ? undefined : groupMenu}
        filter={showRecurring ? undefined : filterMenu}
        menu={[
          { label: "Edit area", onSelect: () => setEditArea(true) },
          // Scoped to this area already: making a pin here should not mean a trip
          // to the Pins page to re-pick the area you are standing in.
          { label: "New list pin", onSelect: addPin.addList },
          { label: "New text pin", onSelect: addPin.addNote },
          { label: "New cadence pin", onSelect: addPin.addTracker },
        ]}
      />
      {area && (
        <AreaDialog open={editArea} onOpenChange={setEditArea} existing={area} />
      )}
      <ProjectDialog open={newProject} onOpenChange={setNewProject} areaId={id} />

      {/* Main column + rail, so an area can carry its own pins. */}
      <div className="lg:flex lg:gap-5">
        <div className="min-w-0 lg:flex-1">
          <PinsStrip scope={scopeForArea(id)} />

          {/* Projects belong to the area's WORK, not to its routines. The
              Recurring tab is a list of things that come round on a schedule, so
              a strip of project cards above it is page chrome that has followed
              you somewhere it means nothing. */}
          {!showRecurring && (
            <div className="mb-5">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xs uppercase tracking-wide text-subtle">
                  Projects
                </h2>
                <button
                  onClick={() => setNewProject(true)}
                  className="text-sm text-primary"
                >
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
          )}

          <h2 className="mb-2 text-xs uppercase tracking-wide text-subtle">
            {showRecurring ? "Recurring" : "Loose tasks"}
          </h2>
          {!showRecurring && (
            <div className="mb-3">
              <QuickCapture defaultAreaId={id} />
            </div>
          )}
          {showRecurring ? (
            <RecurringPanel tasks={tasks} today={today} />
          ) : (
            <>
              {body}
              {/* Say what is being kept out of the list. Tasks quietly vanishing
                  is exactly how a filter like this turns into a bug report. */}
              {dormant.length > 0 && (
                <button
                  onClick={() => setView("recurring")}
                  className="mt-2 flex items-center gap-1.5 text-xs text-subtle transition-colors hover:text-foreground"
                >
                  <RepeatIcon className="h-3.5 w-3.5" />
                  {dormant.length} recurring task{dormant.length === 1 ? "" : "s"} waiting
                  their turn
                </button>
              )}
              {view === "list" && <BulkActionBar controls={controls} />}
            </>
          )}
        </div>
        <PinsSide scope={scopeForArea(id)} />
      </div>
    </div>
  );
}

export function ProjectPage() {
  const { id = "" } = useParams();
  const { open } = useTaskUI();
  const qc = useQueryClient();
  const { data: projects = [] } = useProjects();
  const { data: areas = [] } = useAreas();
  const { viewDefault, setViewDefault } = useViewPrefs();
  const vd = viewDefault(`project:${id}`);
  // A project's old "grid" was always the kanban board, so stored prefs saying
  // "grid" mean board. Mapped on read; no prefs migration needed.
  const view = (vd.mode === "grid" || !vd.mode ? "board" : vd.mode) as ViewMode;
  const sort = (vd.sort as SortKey) ?? "manual";
  const filter = (vd.filter as FilterKey) ?? "all";
  const setView = (m: ViewMode) => setViewDefault(`project:${id}`, { mode: m });
  const [edit, setEdit] = useState(false);
  // The List tab runs on the same machinery as every view page (#2): it used to
  // be a bare list of rows with no selection, no keyboard and no bulk bar, so a
  // project was the one place several tasks could not be changed at once.
  // Called before the loading return, since hooks cannot be conditional.
  const { data: projectTasks = [] } = useTasks({ project_id: id });
  const list = useTaskCollection(
    `project:${id}`,
    projectTasks,
    "No tasks in this project yet.",
    false,
    view === "list"
  );
  const project = projects.find((p) => p.id === id);
  if (!project) return <p className="text-subtle">Loading project...</p>;
  const parentArea = areas.find((a) => a.id === project.area_id);

  // Same stored prefs as before (sort / filter / group under project:<id>), now
  // read through the collection so the board and the list stay in step.
  const { sortMenu, filterMenu, groupMenu } = list;

  return (
    <div>
      <Header
        title={project.name}
        tabs={PROJECT_TABS}
        activeTab={view}
        onTab={setView}
        sort={sortMenu}
        filter={filterMenu}
        // Grouping only means something as a list; the board groups by column.
        group={view === "list" ? groupMenu : undefined}
        menu={[
          { label: "Edit project", onSelect: () => setEdit(true) },
          {
            // A star is the manual "this is current" flag: the sidebar's
            // Starred section and the future dashboard widget read it.
            label: project.starred ? "Unstar project" : "Star project",
            onSelect: async () => {
              await api.updateProject(project.id, {
                starred: project.starred ? 0 : 1,
              });
              qc.invalidateQueries({ queryKey: ["projects"] });
            },
          },
        ]}
        below={
          <div className="space-y-2">
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
      {view === "flow" ? (
        <ProjectFlow project={project} />
      ) : view === "list" ? (
        <div className="max-w-2xl">
          {list.body}
          <BulkActionBar controls={list.controls} />
        </div>
      ) : (
        <ProjectBoard
          project={project}
          view="board"
          onOpen={open}
          transform={(ts) => sortTasks(filterTasks(ts, filter), sort)}
        />
      )}
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
  const { data: filters = [] } = useSavedFilters();
  const { data: tasks = [], isLoading } = useFilterTasks(id);
  const del = useDeleteFilter();
  const [editOpen, setEditOpen] = useState(false);

  const filter = filters.find((f) => f.id === id);
  // The same collection machinery every other task page uses. This page was the
  // odd one out: it went straight to TaskSelection + TaskList, so it had
  // multi-select but no sort, no grouping and no in-view filter, and a saved
  // filter is exactly the kind of long list you want to sort. Keyed per filter,
  // so each one remembers how it likes to be read.
  const { controls, body, sortMenu, groupMenu, filterMenu } = useTaskCollection(
    `filter:${id}`,
    tasks,
    "No tasks match this filter."
  );

  return (
    <div>
      <Header
        title={filter?.name ?? "Filter"}
        icon={<FilterIcon className={ICON_SIZE} />}
        sort={sortMenu}
        group={groupMenu}
        filter={filterMenu}
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
      {isLoading ? <p className="px-2 text-sm text-subtle">Loading…</p> : body}
      <BulkActionBar controls={controls} />
      <FilterDialog open={editOpen} onOpenChange={setEditOpen} existing={filter} />
    </div>
  );
}
