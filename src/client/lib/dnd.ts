import { addMinutes, format, parseISO } from "date-fns";
import type { Task } from "../../shared/types";

// Drag-drop routing for the single app-level DndContext. Kept pure (no network,
// no React) so every branch is unit-testable — see test/dnd.test.ts.

export type DragData = { type?: string; task?: Task } | undefined;

export type DropData =
  | {
      type?: string;
      areaId?: string;
      projectId?: string;
      view?: string;
      column?: string;
      done?: boolean;
      date?: string;
      time?: string;
    }
  | undefined;

export type DropAction =
  | { kind: "update"; id: string; body: Record<string, unknown> }
  | null;

// Resolve a drop into the mutation it should trigger, or null for a no-op.
export function resolveDrop(
  dragged: DragData,
  target: DropData,
  todayStr: string
): DropAction {
  if (!dragged?.task || !target) return null;
  const task = dragged.task;
  const id = task.id;

  switch (target.type) {
    case "area":
      return { kind: "update", id, body: { area_id: target.areaId, project_id: null } };
    case "project":
      return {
        kind: "update",
        id,
        body: { project_id: target.projectId, area_id: target.areaId ?? null },
      };
    case "column":
      return target.column
        ? {
            kind: "update",
            id,
            body: { board_column: target.column, status: target.done ? "done" : "todo" },
          }
        : null;
    case "slot": {
      if (!target.date || !target.time) return null;
      const start = `${target.date}T${target.time}:00`;
      // Moving an already-scheduled block keeps its duration; scheduling a fresh
      // task uses its estimate (or a 60-min default).
      let dur = task.time_estimate_min ?? 60;
      if (task.scheduled_start && task.scheduled_end) {
        const mins =
          (parseISO(task.scheduled_end).getTime() -
            parseISO(task.scheduled_start).getTime()) /
          60000;
        if (mins > 0) dur = Math.round(mins);
      }
      const endD = addMinutes(parseISO(start), dur);
      const end = `${format(endD, "yyyy-MM-dd")}T${format(endD, "HH:mm")}:00`;
      return { kind: "update", id, body: { scheduled_start: start, scheduled_end: end } };
    }
    case "view":
      // Dropping on Today marks intent to work on it today. It keeps the task's
      // area/project and does NOT invent a deadline (that is due_date's job).
      if (target.view === "today")
        return { kind: "update", id, body: { planned_date: todayStr } };
      if (target.view === "backlog")
        return { kind: "update", id, body: { area_id: null, project_id: null } };
      return null;
    default:
      return null;
  }
}
