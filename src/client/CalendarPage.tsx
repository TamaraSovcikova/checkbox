import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { format, addDays, addMinutes, parseISO } from "date-fns";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useQueryClient } from "@tanstack/react-query";
import type { CalendarEvent, Task } from "../shared/types";
import { api } from "./lib/api";
import {
  useCalendarStatus,
  useCalendarEvents,
  useCalendarSync,
  useTasks,
} from "./lib/queries";
import { useTaskUI } from "./lib/ui-context";
import { PRIORITY_VAR } from "./lib/colors";
import { cn } from "@/lib/utils";
import { Button } from "./components/ui/button";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshIcon,
  CalendarIcon,
} from "./lib/icons";

// ── Grid constants ────────────────────────────────────────────────────────────

const GRID_START = 6; // 06:00
const GRID_END = 22; // 22:00
const PX_PER_HOUR = 64;
const SLOT_MIN = 30; // 30-minute droppable slots

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

// ── Droppable slot (resolves in the app-level DndContext) ─────────────────────

function SlotRow({ date, time, top }: { date: string; time: string; top: number }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot:${time}`,
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

function ExternalEventBlock({ event }: { event: CalendarEvent }) {
  const top = timeToPx(event.start);
  const height = durationPx(event.start, event.end);
  if (top < 0 || top > GRID_HEIGHT) return null;
  return (
    <div
      className="absolute left-0 right-1 overflow-hidden rounded border border-border bg-surface-2/70 px-1.5 py-0.5 text-xs"
      style={{ top, height: Math.max(20, height) }}
      title={event.title ?? ""}
    >
      <div className="truncate font-medium text-foreground">
        {event.title ?? "(no title)"}
      </div>
      <div className="text-subtle">{fmtTime(event.start)}</div>
    </div>
  );
}

// ── Checkbox task time-block (draggable to move, resize handle to re-time) ─────

const SNAP_PX = PX_PER_HOUR / 4; // 15-minute snap for resize
const MIN_PX = PX_PER_HOUR / 4; // min 15-minute block

function TaskBlock({ task }: { task: Task }) {
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

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "absolute left-0 right-1 rounded border-l-2 bg-surface-2/90 text-xs text-foreground",
        isDragging ? "z-20 opacity-80 shadow-lg" : "z-0"
      )}
      style={{
        top,
        height: Math.max(20, height),
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
        className="flex h-full w-full cursor-grab flex-col overflow-hidden px-1.5 py-0.5 text-left active:cursor-grabbing"
      >
        <div className="truncate font-medium">{task.title}</div>
        <div className="text-subtle">
          {fmtTime(task.scheduled_start)} – {endLabel}
        </div>
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

// ── Reconnect banner (expired/revoked refresh token) ──────────────────────────

function ReconnectBanner() {
  return (
    <div className="rounded-lg border border-danger/40 bg-danger/5 p-3">
      <p className="text-sm font-medium text-foreground">
        Google Calendar needs reconnecting
      </p>
      <p className="mt-0.5 text-xs text-muted">
        Google expired the access token, so nothing is syncing in either direction.
        If this keeps happening every week, publish the app's OAuth consent screen
        in Google Cloud Console (apps left in "Testing" expire tokens after 7 days).
      </p>
      <Button asChild size="sm" className="mt-2">
        <a href="/api/calendar/connect">Reconnect</a>
      </Button>
    </div>
  );
}

// ── All-day event strip ───────────────────────────────────────────────────────

function AllDayStrip({ events }: { events: CalendarEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1 rounded-md border border-border bg-surface px-2 py-1.5">
      {events.map((e) => (
        <span
          key={e.id}
          className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-foreground"
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

  const scheduledTasks = allTasks.filter(
    (t) => t.scheduled_start?.startsWith(dateStr) && t.status !== "done"
  );
  const unscheduledTasks = allTasks.filter(
    (t) => !t.scheduled_start && t.due_date === dateStr && t.status !== "done"
  );

  const externalEvents = calEvents.filter(
    (e) => !e.all_day && !e.is_checkbox_owned
  );
  const allDayEvents = calEvents.filter((e) => e.all_day);

  if (statusLoading) {
    return (
      <div className="py-24 text-center text-sm text-subtle">Loading...</div>
    );
  }

  if (!status?.connected) {
    return <ConnectCalendar />;
  }

  return (
    <div className="flex h-full flex-col gap-3 pt-4 md:pt-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setDate((d) => addDays(d, -1))}
          className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-surface-2 hover:text-foreground"
          aria-label="Previous day"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <h1 className="text-base font-semibold text-foreground">
          {format(date, "EEEE, d MMMM yyyy")}
        </h1>
        <button
          onClick={() => setDate((d) => addDays(d, 1))}
          className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-surface-2 hover:text-foreground"
          aria-label="Next day"
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
        <Button variant="outline" size="sm" onClick={() => setDate(new Date())}>
          Today
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
        >
          <RefreshIcon className={cn("h-4 w-4", sync.isPending && "animate-spin")} />
          {sync.isPending ? "Syncing…" : "Sync"}
        </Button>
        <span className="text-xs text-subtle">{status.google_email}</span>
      </div>

      {status.needs_reconnect && <ReconnectBanner />}

      {/* All-day strip */}
      <AllDayStrip events={allDayEvents} />

      {/* Body: time grid + unscheduled rail */}
      <div className="flex flex-1 gap-4 overflow-y-auto">
        {/* Hour labels */}
        <div className="relative w-10 shrink-0" style={{ height: GRID_HEIGHT }}>
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

        {/* Time grid */}
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
          {externalEvents.map((e) => (
            <ExternalEventBlock key={e.id} event={e} />
          ))}
          {scheduledTasks.map((t) => (
            <TaskBlock key={t.id} task={t} />
          ))}
          <NowLine dateStr={dateStr} />
        </div>

        {/* Unscheduled task rail */}
        <div className="w-56 shrink-0">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-subtle">
            Unscheduled today
          </div>
          {unscheduledTasks.length === 0 ? (
            <p className="text-xs text-subtle">All tasks scheduled for today.</p>
          ) : (
            <div className="space-y-1.5">
              {unscheduledTasks.map((t) => (
                <RailCard key={t.id} task={t} />
              ))}
            </div>
          )}
          <p className="mt-3 text-[10px] text-subtle">
            Drag a task onto the timeline to schedule it.
          </p>
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
