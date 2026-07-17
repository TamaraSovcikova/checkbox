import {
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { format, addDays, addMinutes, parseISO } from "date-fns";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useQueryClient } from "@tanstack/react-query";
import type { CalendarEvent, Task } from "../shared/types";
import { api } from "./lib/api";
import {
  useCalendarStatus,
  useCalendarRange,
  useCalendarSync,
  useCalendarFeeds,
  useSetCalendarFeed,
  useTasks,
  useViewPrefs,
  useUpdateTask,
} from "./lib/queries";
import { useTaskUI } from "./lib/ui-context";
import { PRIORITY_VAR } from "./lib/colors";
import { packLanes, laneStyle, type Lane } from "./lib/lanes";
import {
  GRID_START,
  GRID_END,
  PX_PER_HOUR,
  SLOT_MIN,
  SLOTS,
  GRID_HEIGHT,
  BLOCK_GAP,
  timeToPx,
  durationPx,
  effectiveInterval,
  fmtTime,
} from "./lib/grid";
import { cn } from "@/lib/utils";
import { Button } from "./components/ui/button";
import { CalendarSyncBanner } from "./components/CalendarSyncBanner";
import { PlanMyDay } from "./components/PlanMyDay";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "./components/ui/popover";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshIcon,
  CalendarIcon,
  CloseIcon,
  AddIcon,
  CheckIcon,
} from "./lib/icons";

// ── Droppable slot (resolves in the app-level DndContext) ─────────────────────

function SlotRow({ date, time, top }: { date: string; time: string; top: number }) {
  // Namespaced by date: in week view the same time exists in 7 columns, and
  // dnd-kit droppable ids are global, so `slot:09:00` alone would collide.
  const { setNodeRef, isOver } = useDroppable({
    id: `slot:${date}:${time}`,
    data: { type: "slot", date, time },
  });
  const isHour = time.endsWith(":00");
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "absolute inset-x-0 border-t",
        isHour ? "border-border" : "border-border/40",
        isOver && "bg-primary/10"
      )}
      style={{ top, height: (SLOT_MIN / 60) * PX_PER_HOUR }}
    />
  );
}

// ── GCal external event block ─────────────────────────────────────────────────

function ExternalEventBlock({
  event,
  lane,
}: {
  event: CalendarEvent;
  lane?: Lane;
}) {
  const top = timeToPx(event.start);
  const height = durationPx(event.start, event.end);
  if (top < 0 || top > GRID_HEIGHT) return null;
  // Google events are a read-only backdrop, tinted with their source calendar's
  // colour so different calendars are distinguishable, but muted (translucent
  // fill + coloured left bar) so they read as "already busy" behind my tasks.
  const color = event.color ?? "var(--muted)";
  const pos = laneStyle(lane);
  const drawH = Math.max(14, height - BLOCK_GAP);
  const compact = drawH < 30; // too short for a title + time line
  return (
    <div
      className={cn(
        "absolute flex flex-col overflow-hidden rounded border border-l-2 leading-none text-foreground/80",
        compact ? "justify-center px-1.5" : "px-1.5 py-0.5"
      )}
      style={{
        top,
        height: drawH,
        left: pos.left,
        width: pos.width,
        backgroundColor: `color-mix(in oklab, ${color} 18%, transparent)`,
        borderColor: `color-mix(in oklab, ${color} 30%, transparent)`,
        borderLeftColor: color,
      }}
      title={event.title ?? ""}
    >
      <div
        className={cn(
          "truncate font-medium",
          compact ? "text-[11px]" : "text-xs"
        )}
      >
        {event.title ?? "(no title)"}
      </div>
      {!compact && drawH >= 40 && (
        <div className="mt-0.5 text-[11px] text-subtle/80">
          {fmtTime(event.start)}
        </div>
      )}
    </div>
  );
}

// ── Checkbox task time-block (draggable to move, resize handle to re-time) ─────

const SNAP_PX = PX_PER_HOUR / 4; // 15-minute snap for resize
const MIN_PX = PX_PER_HOUR / 4; // min 15-minute block

function TaskBlock({ task, lane }: { task: Task; lane?: Lane }) {
  const { open } = useTaskUI();
  const qc = useQueryClient();
  // Live height override while resizing (null = use the stored duration).
  const [resizeH, setResizeH] = useState<number | null>(null);
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id, data: { type: "task", task } });

  if (!task.scheduled_start || !task.scheduled_end) return null;
  const top = timeToPx(task.scheduled_start);
  const baseH = durationPx(task.scheduled_start, task.scheduled_end);
  const height = resizeH ?? baseH;
  if (top < 0 || top > GRID_HEIGHT) return null;

  // Bottom-edge resize: a raw pointer drag (kept off the dnd-kit listeners via
  // stopPropagation) that snaps the end time to 15 minutes and commits on release.
  function onResizeDown(e: ReactPointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    const startH = baseH;
    const clamp = (h: number) =>
      Math.max(MIN_PX, Math.round(h / SNAP_PX) * SNAP_PX);
    const move = (ev: PointerEvent) => setResizeH(clamp(startH + (ev.clientY - startY)));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const finalH = clamp(startH + (ev.clientY - startY));
      setResizeH(null);
      const minutes = Math.round((finalH / PX_PER_HOUR) * 60);
      const end = addMinutes(parseISO(task.scheduled_start!), minutes);
      api
        .updateTask(task.id, {
          scheduled_end: `${format(end, "yyyy-MM-dd")}T${format(end, "HH:mm")}:00`,
        })
        .then(() => {
          qc.invalidateQueries({ queryKey: ["tasks"] });
          qc.invalidateQueries({ queryKey: ["view"] });
        });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const endLabel = resizeH
    ? fmtTime(
        addMinutes(
          parseISO(task.scheduled_start),
          Math.round((height / PX_PER_HOUR) * 60)
        ).toISOString()
      )
    : fmtTime(task.scheduled_end);

  // Take the task off the timeline: clears its time-block so it returns to the
  // left "To schedule" pane. The server's pushTaskToGcal removes the Google
  // Calendar event it created (unless the task still has a due date to keep).
  function unschedule(e: ReactMouseEvent) {
    e.stopPropagation();
    api
      .updateTask(task.id, { scheduled_start: null, scheduled_end: null })
      .then(() => {
        qc.invalidateQueries({ queryKey: ["tasks"] });
        qc.invalidateQueries({ queryKey: ["view"] });
        qc.invalidateQueries({ queryKey: ["calendar", "events"] });
      });
  }

  const pos = laneStyle(lane);
  const drawH = Math.max(14, height - BLOCK_GAP);
  const compact = drawH < 30; // too short for a title + time line
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group absolute rounded border border-l-2 leading-none text-foreground backdrop-blur-[1px]",
        isDragging ? "z-20 opacity-80 shadow-lg" : "z-10"
      )}
      style={{
        top,
        height: drawH,
        left: pos.left,
        width: pos.width,
        // Checkbox blocks are "mine": a priority-tinted fill + a solid priority
        // left bar, so they read distinctly from the muted Google backdrop.
        backgroundColor: `color-mix(in oklab, ${PRIORITY_VAR[task.priority]} 22%, transparent)`,
        borderColor: `color-mix(in oklab, ${PRIORITY_VAR[task.priority]} 35%, transparent)`,
        borderLeftColor: PRIORITY_VAR[task.priority],
        transform: transform ? CSS.Translate.toString(transform) : undefined,
      }}
      title={task.title}
    >
      {/* Body: click opens the task; press-and-drag (>6px) moves the block. */}
      <button
        {...attributes}
        {...listeners}
        onClick={() => open(task)}
        className={cn(
          "flex h-full w-full cursor-grab flex-col overflow-hidden px-1.5 pr-5 text-left active:cursor-grabbing",
          compact ? "justify-center" : "py-0.5"
        )}
      >
        <div
          className={cn(
            "truncate font-medium",
            compact ? "text-[11px]" : "text-xs"
          )}
        >
          {task.title}
        </div>
        {!compact && drawH >= 40 && (
          <div className="mt-0.5 text-[11px] text-subtle">
            {fmtTime(task.scheduled_start)} – {endLabel}
          </div>
        )}
      </button>
      {/* Unschedule: send the task back to the left pane (and remove its GCal
          event). Hidden until hover; stops the drag/open handlers. */}
      <button
        onClick={unschedule}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Remove from calendar"
        title="Remove from calendar"
        // Faintly visible always (touch has no hover), full on hover/tap.
        className="absolute right-0.5 top-0.5 z-10 grid h-4 w-4 place-items-center rounded text-foreground/70 opacity-50 transition-opacity hover:bg-black/10 hover:text-foreground group-hover:opacity-100"
      >
        <CloseIcon className="h-3 w-3" />
      </button>
      {/* Bottom resize handle. */}
      <div
        onPointerDown={onResizeDown}
        className="absolute inset-x-0 bottom-0 flex h-2 cursor-ns-resize items-center justify-center"
        title="Drag to resize"
      >
        <div className="h-0.5 w-4 rounded-full bg-foreground/30" />
      </div>
    </div>
  );
}

// ── Draggable rail card ───────────────────────────────────────────────────────

function RailCard({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id, data: { type: "task", task } });
  const style = transform
    ? { transform: CSS.Transform.toString(transform) }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "cursor-grab select-none rounded-md border border-border bg-surface px-2 py-1.5 text-sm",
        isDragging && "opacity-50"
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: PRIORITY_VAR[task.priority] }}
        />
        <span className="truncate text-foreground">{task.title}</span>
      </div>
      {task.time_estimate_min && (
        <div className="mt-0.5 text-xs text-subtle">
          {task.time_estimate_min} min
        </div>
      )}
    </div>
  );
}

// ── Connect prompt (no calendar linked) ──────────────────────────────────────

function ConnectCalendar() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <CalendarIcon className="h-10 w-10 text-primary" />
      <h2 className="text-lg font-semibold text-foreground">
        Connect Google Calendar
      </h2>
      <p className="max-w-sm text-sm text-muted">
        See your meetings as a backdrop, drag tasks onto the timeline, and push
        time-blocks back to Google Calendar.
      </p>
      <Button asChild>
        <a href="/api/calendar/connect">Connect Google Calendar</a>
      </Button>
    </div>
  );
}

// ── Sync-broken banner ────────────────────────────────────────────────────────

// ── All-day box ───────────────────────────────────────────────────────────────

// A chip in the all-day box. Two kinds, which hide very differently:
//
//   "task"     - an event CHECKBOX created for one of your tasks. Hiding it sets
//                tasks.gcal_hidden, so the Worker DELETES the event from Google
//                and stops re-creating it. The task's due date is untouched, so
//                un-hiding pushes a fresh event back.
//   "external" - an entry from the rest of your calendar. Not ours to delete, so
//                hiding is local only (UserPrefs.hiddenAllDayTitles), keyed by
//                title: these are usually standing reminders that recur, and each
//                instance gets its own event id, so hiding by id would only ever
//                hide today's.
type AllDayChip = {
  key: string;
  label: string;
  day: string; // YYYY-MM-DD
  kind: "task" | "external";
  taskId?: string;
  hidden: boolean;
};

// `events` are the all-day events on the visible days; `tasks` is needed as well
// because a hidden task has NO event any more (we deleted it from Google), so it
// cannot come from the cache and would be unrecoverable if we only read events.
// `dedupeTaskIds` are tasks already listed in the "To schedule" pane: showing them
// here too is the duplication that made this box noisy.
function AllDayBox({
  events,
  tasks,
  days,
  dedupeTaskIds,
}: {
  events: CalendarEvent[];
  tasks: Task[];
  days: string[];
  dedupeTaskIds: Set<string>;
}) {
  const { isAllDayHidden, toggleAllDayTitle } = useViewPrefs();
  const updateTask = useUpdateTask();
  const qc = useQueryClient();
  const [showHidden, setShowHidden] = useState(false);

  const inRange = (d: string | null) => !!d && days.includes(d);

  // Hidden-ness is read from the TASK ROW, never from the event cache. Hiding
  // deletes the Google event server-side, but the cached row lingers until the
  // next calendar fetch, so a cache-derived chip would still show as visible AND
  // appear again in the hidden list. The task row is the authoritative answer.
  const hiddenTaskIds = new Set(
    tasks.filter((t) => t.gcal_hidden).map((t) => t.id)
  );

  const chips: AllDayChip[] = [
    ...events.flatMap((e): AllDayChip[] => {
      const day = e.start.slice(0, 10);
      const label = e.title ?? "(all-day)";
      if (e.is_checkbox_owned) {
        // Ours. Skip it if hidden (the row below rebuilds it from the task), or
        // if the To schedule pane is already showing this task.
        if (!e.task_id || hiddenTaskIds.has(e.task_id) || dedupeTaskIds.has(e.task_id))
          return [];
        return [{ key: e.id, label, day, kind: "task", taskId: e.task_id, hidden: false }];
      }
      return [{ key: e.id, label, day, kind: "external", hidden: isAllDayHidden(label) }];
    }),
    // Hidden tasks, rebuilt from the task rows. Deliberately NOT deduped against
    // the To schedule pane: a hidden task has no chip anywhere else, so this list
    // is the only way back. It is collapsed by default, so it costs no noise.
    ...tasks
      .filter((t) => t.gcal_hidden && t.status !== "done" && inRange(t.due_date))
      .map((t): AllDayChip => ({
        key: `task:${t.id}`,
        label: t.title,
        day: t.due_date as string,
        kind: "task",
        taskId: t.id,
        hidden: true,
      })),
  ];

  if (chips.length === 0) return null;
  const visible = chips.filter((c) => !c.hidden);
  const hidden = chips.filter((c) => c.hidden);

  function toggle(chip: AllDayChip) {
    if (chip.kind === "task" && chip.taskId) {
      updateTask.mutate(
        { id: chip.taskId, body: { gcal_hidden: chip.hidden ? 0 : 1 } },
        // The Worker deletes/recreates the Google event in the background, so the
        // event cache is stale either way; refetch it so the rest of the page
        // agrees. The chip itself does not wait on this (see hiddenTaskIds).
        { onSuccess: () => qc.invalidateQueries({ queryKey: ["calendar"] }) }
      );
    } else {
      toggleAllDayTitle(chip.label);
    }
  }

  // In week view the chips span seven days, so date them. In day view that would
  // repeat the same date on every chip, so don't.
  const dayOf = (c: AllDayChip) =>
    days.length > 1 ? format(parseISO(c.day), "EEE d") : null;

  return (
    <div className="mb-2 rounded-lg border border-border bg-surface px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-foreground">All-day</span>
        <span className="rounded-full bg-surface-2 px-1.5 text-[11px] tabular-nums text-muted">
          {visible.length}
        </span>
        {visible.length > 0 && (
          <span className="text-[11px] text-subtle">click to hide</span>
        )}
        {hidden.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHidden((v) => !v)}
            className="ml-auto text-[11px] text-subtle transition-colors hover:text-foreground"
          >
            {hidden.length} hidden {showHidden ? "▴" : "▾"}
          </button>
        )}
      </div>

      {visible.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {visible.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => toggle(c)}
              title={
                c.kind === "task"
                  ? `Hide "${c.label}" and remove it from Google Calendar`
                  : `Hide "${c.label}" here (stays on Google Calendar)`
              }
              className="group inline-flex max-w-full items-center gap-1.5 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-xs text-foreground transition-colors hover:border-danger/40"
            >
              {/* A tick means it is one of your Checkbox tasks. */}
              {c.kind === "task" && (
                <CheckIcon className="h-3 w-3 shrink-0 text-primary" />
              )}
              {dayOf(c) && (
                <span className="shrink-0 tabular-nums text-subtle">{dayOf(c)}</span>
              )}
              <span className="truncate">{c.label}</span>
              <CloseIcon className="h-3 w-3 shrink-0 text-subtle transition-colors group-hover:text-danger" />
            </button>
          ))}
        </div>
      )}
      {visible.length === 0 && (
        <p className="mt-1.5 text-[11px] text-subtle">
          Nothing to show. Anything due today that still needs a time is in To schedule.
        </p>
      )}

      {/* Hidden entries, restorable. A hidden task gets its Google event back. */}
      {showHidden && hidden.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1 border-t border-border pt-1.5">
          {hidden.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => toggle(c)}
              title={
                c.kind === "task"
                  ? "Show again, and put it back on Google Calendar"
                  : "Show this entry again"
              }
              className="inline-flex max-w-full items-center gap-1.5 rounded border border-dashed border-input px-1.5 py-0.5 text-xs text-subtle transition-colors hover:text-foreground"
            >
              <span className="truncate">{c.label}</span>
              <AddIcon className="h-3 w-3 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main CalendarPage ─────────────────────────────────────────────────────────

// One day's grid: droppable slots, external events, task blocks, now-line. The
// unit shared by day view (one of these) and week view (seven side by side).
function DayColumn({
  dateStr,
  events,
  tasks,
  header,
}: {
  dateStr: string;
  events: CalendarEvent[];
  tasks: Task[];
  header?: { weekday: string; day: string; isToday: boolean };
}) {
  // Bucket by local day: external event starts are stored UTC, so compare the
  // local calendar day, not the UTC prefix.
  const external = events.filter(
    (e) =>
      !e.all_day &&
      !e.is_checkbox_owned &&
      format(parseISO(e.start), "yyyy-MM-dd") === dateStr
  );
  const scheduled = tasks.filter(
    (t) => t.scheduled_start?.startsWith(dateStr) && t.status !== "done"
  );
  // Pack external events and task blocks into shared columns so overlaps sit
  // side by side (an all-day "Internship" block next to the tasks within it).
  const lanes = packLanes([
    ...external.map((e) => ({ key: `e:${e.id}`, ...effectiveInterval(e.start, e.end) })),
    ...scheduled.map((t) => ({
      key: `t:${t.id}`,
      ...effectiveInterval(t.scheduled_start!, t.scheduled_end ?? t.scheduled_start!),
    })),
  ]);
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {header && (
        <div
          className={cn(
            "mb-1 flex items-baseline justify-center gap-1 text-center",
            header.isToday ? "text-primary" : "text-subtle"
          )}
        >
          <span className="text-[11px] uppercase tracking-wide">{header.weekday}</span>
          <span className="text-sm font-semibold">{header.day}</span>
        </div>
      )}
      <div
        className="relative flex-1 border-l border-border"
        style={{ height: GRID_HEIGHT }}
      >
        {SLOTS.map((slot, i) => (
          <SlotRow
            key={slot}
            date={dateStr}
            time={slot}
            top={i * ((SLOT_MIN / 60) * PX_PER_HOUR)}
          />
        ))}
        {external.map((e) => (
          <ExternalEventBlock key={e.id} event={e} lane={lanes.get(`e:${e.id}`)} />
        ))}
        {scheduled.map((t) => (
          <TaskBlock key={t.id} task={t} lane={lanes.get(`t:${t.id}`)} />
        ))}
        <NowLine dateStr={dateStr} />
      </div>
    </div>
  );
}

// Monday-based start of the week containing `d`.
function weekStart(d: Date): Date {
  const offset = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  return addDays(d, -offset);
}

// One labelled group of drag-to-schedule cards in the left planner pane.
function PlannerGroup({
  label,
  tone,
  tasks,
}: {
  label: string;
  tone?: "overdue";
  tasks: Task[];
}) {
  if (tasks.length === 0) return null;
  return (
    <div className="mb-3">
      <div
        className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wide"
        style={tone === "overdue" ? { color: "var(--area-orange)" } : undefined}
      >
        <span className={tone === "overdue" ? "" : "text-subtle"}>{label}</span>
        <span className="text-subtle/60">{tasks.length}</span>
      </div>
      <div className="space-y-1.5">
        {tasks.map((t) => (
          <RailCard key={t.id} task={t} />
        ))}
      </div>
    </div>
  );
}

// Discreet header control: pick which Google calendars show on the grid.
function CalendarPicker() {
  const { data: feeds = [] } = useCalendarFeeds();
  const setFeed = useSetCalendarFeed();
  if (feeds.length === 0) return null;
  const hiddenCount = feeds.filter((f) => !f.enabled).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="relative grid h-7 w-7 place-items-center rounded text-muted hover:bg-surface-2 hover:text-foreground"
          aria-label="Choose calendars"
          title="Choose calendars"
        >
          <CalendarIcon className="h-4 w-4" />
          {hiddenCount > 0 && (
            <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-1.5">
        <div className="px-1.5 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">
          Calendars
        </div>
        <div className="max-h-72 space-y-0.5 overflow-y-auto">
          {feeds.map((f) => {
            const color = f.color ?? "var(--muted)";
            return (
              <button
                key={f.calendar_id}
                disabled={f.primary || setFeed.isPending}
                onClick={() =>
                  setFeed.mutate({ id: f.calendar_id, enabled: !f.enabled })
                }
                className={cn(
                  "flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm",
                  f.primary ? "cursor-default" : "hover:bg-surface-2"
                )}
                title={f.primary ? "Primary calendar (always shown)" : undefined}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full border"
                  style={{
                    backgroundColor: f.enabled ? color : "transparent",
                    borderColor: color,
                  }}
                />
                <span
                  className={cn(
                    "truncate",
                    f.enabled ? "text-foreground" : "text-subtle"
                  )}
                >
                  {f.summary ?? f.calendar_id}
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function CalendarPage() {
  const [date, setDate] = useState(() => new Date());
  const [view, setView] = useState<"day" | "week">("day");

  // The visible days, and the fetch window that covers them.
  const days =
    view === "day"
      ? [date]
      : Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i));
  const rangeStart = format(days[0], "yyyy-MM-dd");
  const rangeEndExclusive = format(addDays(days[days.length - 1], 1), "yyyy-MM-dd");

  const { data: status, isLoading: statusLoading } = useCalendarStatus();
  const { data: calEvents = [] } = useCalendarRange(rangeStart, rangeEndExclusive);
  const { data: allTasks = [] } = useTasks({});
  const sync = useCalendarSync();
  const todayStr = format(new Date(), "yyyy-MM-dd");

  // Every all-day entry on the visible days, ours included. An earlier version
  // dropped is_checkbox_owned ones to stop tasks showing twice, but they are the
  // overwhelming majority (25 of 28) so the box rendered empty. The duplication
  // it was guarding against was really STALE events from done/deleted tasks, and
  // reconcileTaskEvents fixes that at the source. Hide per entry instead.
  const allDayEvents = calEvents.filter((e) => e.all_day);

  // "Plan my day" time-blocks TODAY's open tasks, so it always works off today
  // regardless of which day/week the grid is showing.
  const planCandidates = allTasks.filter(
    (t) =>
      t.status !== "done" &&
      (t.due_date === todayStr ||
        (t.due_date != null && t.due_date < todayStr) ||
        t.planned_date === todayStr ||
        t.scheduled_start?.slice(0, 10) === todayStr)
  );

  // Left planner pane: unscheduled open tasks to drag onto the grid. Scoped to
  // TODAY only: what you planned for today or that is due today, plus overdue
  // tasks that still need doing now. Future-dated and no-date tasks are
  // deliberately excluded so the pane stays a focused "schedule today" list.
  const openUnscheduled = allTasks.filter(
    (t) => !t.scheduled_start && t.status !== "done"
  );
  const overdue = openUnscheduled.filter(
    (t) => t.due_date != null && t.due_date < todayStr
  );
  const overdueIds = new Set(overdue.map((t) => t.id));
  const today = openUnscheduled.filter(
    (t) =>
      !overdueIds.has(t.id) &&
      (t.planned_date === todayStr || t.due_date === todayStr)
  );
  const nothingToSchedule = today.length + overdue.length === 0;

  function step(dir: 1 | -1) {
    setDate((d) => addDays(d, dir * (view === "week" ? 7 : 1)));
  }

  if (statusLoading) {
    return (
      <div className="py-24 text-center text-sm text-subtle">Loading...</div>
    );
  }

  if (!status?.connected) {
    return <ConnectCalendar />;
  }

  const title =
    view === "day"
      ? format(date, "EEEE, d MMMM yyyy")
      : `${format(days[0], "d MMM")} – ${format(days[6], "d MMM yyyy")}`;

  return (
    <div className="flex h-full flex-col gap-3 pt-4 md:pt-6">
      {/* Header. Wraps: the date + its arrows take their own line on a phone,
          the controls follow underneath. Unwrapped, the title was the only
          shrinkable thing in the row and collapsed to nothing. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 basis-full items-center gap-1 sm:basis-auto">
          <button
            onClick={() => step(-1)}
            className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted hover:bg-surface-2 hover:text-foreground"
            aria-label={view === "week" ? "Previous week" : "Previous day"}
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <h1 className="min-w-0 truncate text-base font-semibold text-foreground">
            {title}
          </h1>
          <button
            onClick={() => step(1)}
            className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted hover:bg-surface-2 hover:text-foreground"
            aria-label={view === "week" ? "Next week" : "Next day"}
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
        <Button variant="outline" size="sm" onClick={() => setDate(new Date())}>
          Today
        </Button>

        {/* Day / Week toggle */}
        <div className="flex overflow-hidden rounded-md border border-border">
          {(["day", "week"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                view === v
                  ? "bg-surface-2 text-foreground"
                  : "text-muted hover:bg-surface-2/60 hover:text-foreground"
              )}
            >
              {v}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <CalendarPicker />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
          >
            <RefreshIcon className={cn("h-4 w-4", sync.isPending && "animate-spin")} />
            {sync.isPending ? "Syncing…" : "Sync"}
          </Button>
        </div>
        <span className="hidden text-xs text-subtle md:inline">
          {status.google_email}
        </span>
      </div>

      <CalendarSyncBanner status={status} />

      {/* Plan my day: auto time-block today's tasks around your meetings. Lives
          here (not on Today) since Today has the task-selection planners. */}
      <PlanMyDay tasks={planCandidates} />

      {/* All-day strip (across the visible range) */}
      <AllDayBox
        events={allDayEvents}
        tasks={allTasks}
        days={days.map((d) => format(d, "yyyy-MM-dd"))}
        // Anything the To schedule pane is already listing: showing it as an
        // all-day chip as well is the duplicate. It keeps its Google all-day
        // event either way, until you give it a time slot.
        dedupeTaskIds={new Set([...today, ...overdue].map((t) => t.id))}
      />

      {/* Body: left planner pane + hour labels + one-or-seven day columns.
          pt-2 keeps the 06:00 label + first event off the clipped top edge. */}
      <div className="flex flex-1 gap-3 overflow-auto pt-2">
        {/* Left planner pane: the tasks you drag onto the calendar. Desktop only.
            It is a fixed 208px that will not shrink, which on a 375px phone left
            the grid itself about 100px wide; and its whole purpose is dragging
            onto the timeline, which is not a gesture a phone affords anyway. The
            grid gets the full width instead. */}
        <div
          className="hidden w-52 shrink-0 overflow-y-auto border-r border-border pr-3 md:block"
          style={{ marginTop: view === "week" ? 24 : 0 }}
        >
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/80">
            To schedule
          </div>
          <PlannerGroup label="Today" tasks={today} />
          <PlannerGroup label="Overdue" tone="overdue" tasks={overdue} />
          {nothingToSchedule && (
            <p className="text-xs text-subtle">Nothing to schedule today.</p>
          )}
          <p className="mt-3 text-[10px] text-subtle">
            Drag a task onto the timeline to schedule it.
          </p>
        </div>

        {/* Hour labels */}
        <div
          className="relative w-10 shrink-0"
          style={{ height: GRID_HEIGHT, marginTop: view === "week" ? 24 : 0 }}
        >
          {Array.from(
            { length: GRID_END - GRID_START },
            (_, i) => GRID_START + i
          ).map((h) => (
            <div
              key={h}
              className="absolute right-0 text-[10px] leading-none text-subtle"
              style={{ top: (h - GRID_START) * PX_PER_HOUR - 5 }}
            >
              {String(h).padStart(2, "0")}
            </div>
          ))}
        </div>

        {/* Day column(s) */}
        <div className="flex min-w-0 flex-1 gap-1">
          {days.map((d) => {
            const ds = format(d, "yyyy-MM-dd");
            return (
              <DayColumn
                key={ds}
                dateStr={ds}
                events={calEvents}
                tasks={allTasks}
                header={
                  view === "week"
                    ? {
                        weekday: format(d, "EEE"),
                        day: format(d, "d"),
                        isToday: ds === todayStr,
                      }
                    : undefined
                }
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Current-time line ─────────────────────────────────────────────────────────

function NowLine({ dateStr }: { dateStr: string }) {
  const now = new Date();
  const todayStr = format(now, "yyyy-MM-dd");
  if (dateStr !== todayStr) return null;
  const top = timeToPx(now.toISOString());
  if (top < 0 || top > GRID_HEIGHT) return null;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
      style={{ top }}
    >
      <div className="-ml-1 h-2 w-2 rounded-full bg-danger" />
      <div className="flex-1 border-t border-danger" />
    </div>
  );
}
