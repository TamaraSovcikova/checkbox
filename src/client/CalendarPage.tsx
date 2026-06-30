import { useState } from "react";
import { format, addDays, parseISO, addMinutes } from "date-fns";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { CalendarEvent, Task } from "../shared/types";
import {
  useCalendarStatus,
  useCalendarEvents,
  useCalendarSync,
  useUpdateTask,
  useTasks,
} from "./lib/queries";
import { useTaskUI } from "./lib/ui-context";
import { cx } from "./components/ui";

// ── Grid constants ────────────────────────────────────────────────────────────

const GRID_START = 6; // 06:00
const GRID_END = 22; // 22:00
const PX_PER_HOUR = 64;
const SLOT_MIN = 30; // 30-minute droppable slots

// Generate slot times: ["06:00", "06:30", ..., "21:30"]
const SLOTS: string[] = Array.from(
  { length: ((GRID_END - GRID_START) * 60) / SLOT_MIN },
  (_, i) => {
    const totalMin = GRID_START * 60 + i * SLOT_MIN;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
);

const GRID_HEIGHT = (GRID_END - GRID_START) * PX_PER_HOUR;

// ── Time helpers ──────────────────────────────────────────────────────────────

function parseHM(isoOrHHMM: string): { h: number; m: number } | null {
  if (!isoOrHHMM) return null;
  if (isoOrHHMM.includes("T")) {
    const d = new Date(isoOrHHMM);
    if (isNaN(d.getTime())) return null;
    return { h: d.getHours(), m: d.getMinutes() };
  }
  const [h, m] = isoOrHHMM.split(":").map(Number);
  return { h, m };
}

function timeToPx(isoOrHHMM: string): number {
  const t = parseHM(isoOrHHMM);
  if (!t) return 0;
  return (t.h - GRID_START + t.m / 60) * PX_PER_HOUR;
}

function durationPx(start: string, end: string): number {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  const hours = Math.max(0.5, (e - s) / 3_600_000);
  return hours * PX_PER_HOUR;
}

function fmtTime(iso: string): string {
  const t = parseHM(iso);
  if (!t) return "";
  return `${String(t.h).padStart(2, "0")}:${String(t.m).padStart(2, "0")}`;
}

// ── Priority colours ──────────────────────────────────────────────────────────

const PRI_BG: Record<number, string> = {
  1: "bg-red-900/80 border-red-700",
  2: "bg-orange-900/80 border-orange-700",
  3: "bg-blue-900/80 border-blue-700",
  4: "bg-slate-800/80 border-slate-600",
};

// ── Droppable slot ────────────────────────────────────────────────────────────

function SlotRow({ slotId, top }: { slotId: string; top: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: slotId });
  const isHour = slotId.endsWith(":00");
  return (
    <div
      ref={setNodeRef}
      className={cx(
        "absolute inset-x-0 border-t",
        isHour ? "border-slate-700" : "border-slate-800/50",
        isOver && "bg-blue-900/20"
      )}
      style={{ top, height: (SLOT_MIN / 60) * PX_PER_HOUR }}
    />
  );
}

// ── GCal external event block ─────────────────────────────────────────────────

function ExternalEventBlock({ event }: { event: CalendarEvent }) {
  const top = timeToPx(event.start);
  const height = durationPx(event.start, event.end);
  if (top < 0 || top > GRID_HEIGHT) return null;
  return (
    <div
      className="absolute left-0 right-1 rounded border border-slate-600 bg-slate-700/70 px-1.5 py-0.5 text-xs overflow-hidden"
      style={{ top, height: Math.max(20, height) }}
      title={event.title ?? ""}
    >
      <div className="font-medium text-slate-200 truncate">
        {event.title ?? "(no title)"}
      </div>
      <div className="text-slate-400">{fmtTime(event.start)}</div>
    </div>
  );
}

// ── Checkbox task time-block ──────────────────────────────────────────────────

function TaskBlock({ task }: { task: Task }) {
  const { open } = useTaskUI();
  if (!task.scheduled_start || !task.scheduled_end) return null;
  const top = timeToPx(task.scheduled_start);
  const height = durationPx(task.scheduled_start, task.scheduled_end);
  if (top < 0 || top > GRID_HEIGHT) return null;
  return (
    <button
      onClick={() => open(task)}
      className={cx(
        "absolute left-0 right-1 rounded border px-1.5 py-0.5 text-left text-xs overflow-hidden",
        PRI_BG[task.priority] ?? PRI_BG[4]
      )}
      style={{ top, height: Math.max(20, height) }}
      title={task.title}
    >
      <div className="font-medium text-white truncate">{task.title}</div>
      <div className="text-slate-300">
        {fmtTime(task.scheduled_start)} – {fmtTime(task.scheduled_end)}
      </div>
    </button>
  );
}

// ── Draggable rail card ───────────────────────────────────────────────────────

function RailCard({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id });
  const style = transform
    ? { transform: CSS.Transform.toString(transform) }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cx(
        "rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm cursor-grab select-none",
        isDragging && "opacity-50"
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={cx(
            "h-2 w-2 shrink-0 rounded-full",
            task.priority === 1
              ? "bg-red-500"
              : task.priority === 2
                ? "bg-orange-400"
                : task.priority === 3
                  ? "bg-blue-400"
                  : "bg-slate-500"
          )}
        />
        <span className="truncate text-slate-100">{task.title}</span>
      </div>
      {task.time_estimate_min && (
        <div className="mt-0.5 text-xs text-slate-400">
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
      <div className="text-4xl">📅</div>
      <h2 className="text-lg font-semibold text-slate-100">
        Connect Google Calendar
      </h2>
      <p className="max-w-sm text-sm text-slate-400">
        See your meetings as a backdrop, drag tasks onto the timeline, and push
        time-blocks back to Google Calendar.
      </p>
      <a
        href="/api/calendar/connect"
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
      >
        Connect Google Calendar
      </a>
      <p className="text-xs text-slate-600">
        Requires GOOGLE_CLIENT_ID in .dev.vars (local) or wrangler secrets
        (prod).
      </p>
    </div>
  );
}

// ── All-day event strip ───────────────────────────────────────────────────────

function AllDayStrip({ events }: { events: CalendarEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1 rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5">
      {events.map((e) => (
        <span
          key={e.id}
          className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-200"
        >
          {e.title ?? "(all-day)"}
        </span>
      ))}
    </div>
  );
}

// ── Main CalendarPage ─────────────────────────────────────────────────────────

export default function CalendarPage() {
  const [date, setDate] = useState(() => new Date());
  const dateStr = format(date, "yyyy-MM-dd");

  const { data: status, isLoading: statusLoading } = useCalendarStatus();
  const { data: calEvents = [] } = useCalendarEvents(dateStr);
  const { data: allTasks = [] } = useTasks({});
  const sync = useCalendarSync();
  const updateTask = useUpdateTask();

  // Filter tasks relevant to this date.
  const scheduledTasks = allTasks.filter(
    (t) =>
      t.scheduled_start?.startsWith(dateStr) && t.status !== "done"
  );
  const unscheduledTasks = allTasks.filter(
    (t) =>
      !t.scheduled_start &&
      t.due_date === dateStr &&
      t.status !== "done"
  );

  const externalEvents = calEvents.filter(
    (e) => !e.all_day && !e.is_checkbox_owned
  );
  const allDayEvents = calEvents.filter((e) => e.all_day);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function onDragEnd(ev: DragEndEvent) {
    const { active, over } = ev;
    if (!over) return;
    const overId = String(over.id);
    if (!overId.startsWith("slot-")) return;

    const slotTime = overId.replace("slot-", ""); // "HH:MM"
    const task = allTasks.find((t) => t.id === active.id);
    if (!task) return;

    const startIso = `${dateStr}T${slotTime}:00`;
    const durationMin = task.time_estimate_min ?? 60;
    const endDate = addMinutes(parseISO(startIso), durationMin);
    const endIso = `${format(endDate, "yyyy-MM-dd")}T${format(endDate, "HH:mm")}:00`;

    updateTask.mutate({
      id: String(active.id),
      body: { scheduled_start: startIso, scheduled_end: endIso },
    });
  }

  if (statusLoading) {
    return (
      <div className="py-24 text-center text-sm text-slate-500">
        Loading...
      </div>
    );
  }

  if (!status?.connected) {
    return <ConnectCalendar />;
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex h-full flex-col gap-3">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setDate((d) => addDays(d, -1))}
            className="rounded p-1 text-slate-400 hover:text-slate-100"
          >
            ‹
          </button>
          <h1 className="text-base font-semibold text-slate-100">
            {format(date, "EEEE, d MMMM yyyy")}
          </h1>
          <button
            onClick={() => setDate((d) => addDays(d, 1))}
            className="rounded p-1 text-slate-400 hover:text-slate-100"
          >
            ›
          </button>
          <button
            onClick={() => setDate(new Date())}
            className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-400 hover:text-slate-200"
          >
            Today
          </button>
          <button
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            className="ml-auto rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-40"
          >
            {sync.isPending ? "Syncing…" : "Sync"}
          </button>
          <span className="text-xs text-slate-600">{status.google_email}</span>
        </div>

        {/* All-day strip */}
        <AllDayStrip events={allDayEvents} />

        {/* Body: time grid + unscheduled rail */}
        <div className="flex flex-1 gap-4 overflow-y-auto">
          {/* Hour labels */}
          <div
            className="relative shrink-0 w-10"
            style={{ height: GRID_HEIGHT }}
          >
            {Array.from(
              { length: GRID_END - GRID_START },
              (_, i) => GRID_START + i
            ).map((h) => (
              <div
                key={h}
                className="absolute right-0 text-[10px] text-slate-500 leading-none"
                style={{ top: (h - GRID_START) * PX_PER_HOUR - 5 }}
              >
                {String(h).padStart(2, "0")}
              </div>
            ))}
          </div>

          {/* Time grid */}
          <div
            className="relative flex-1 border-l border-slate-800"
            style={{ height: GRID_HEIGHT }}
          >
            {/* Droppable slots */}
            {SLOTS.map((slot, i) => (
              <SlotRow
                key={slot}
                slotId={`slot-${slot}`}
                top={i * ((SLOT_MIN / 60) * PX_PER_HOUR)}
              />
            ))}
            {/* External GCal events (read-only backdrop) */}
            {externalEvents.map((e) => (
              <ExternalEventBlock key={e.id} event={e} />
            ))}
            {/* Checkbox task blocks */}
            {scheduledTasks.map((t) => (
              <TaskBlock key={t.id} task={t} />
            ))}
            {/* Current-time indicator */}
            <NowLine dateStr={dateStr} />
          </div>

          {/* Unscheduled task rail */}
          <div className="w-56 shrink-0">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-slate-500">
              Unscheduled today
            </div>
            {unscheduledTasks.length === 0 ? (
              <p className="text-xs text-slate-600">
                All tasks scheduled for today.
              </p>
            ) : (
              <div className="space-y-1.5">
                {unscheduledTasks.map((t) => (
                  <RailCard key={t.id} task={t} />
                ))}
              </div>
            )}
            <p className="mt-3 text-[10px] text-slate-700">
              Drag a task onto the timeline to schedule it.
            </p>
          </div>
        </div>
      </div>
    </DndContext>
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
      <div className="h-2 w-2 rounded-full bg-red-500 -ml-1" />
      <div className="flex-1 border-t border-red-500" />
    </div>
  );
}
