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
  | { kind: "reschedule"; id: string; dueDate: string }
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
      const dur = task.time_estimate_min ?? 60;
      const endD = addMinutes(parseISO(start), dur);
      const end = `${format(endD, "yyyy-MM-dd")}T${format(endD, "HH:mm")}:00`;
      return { kind: "update", id, body: { scheduled_start: start, scheduled_end: end } };
    }
    case "view":
      if (target.view === "today") return { kind: "reschedule", id, dueDate: todayStr };
      if (target.view === "backlog")
        return { kind: "update", id, body: { area_id: null, project_id: null } };
      return null;
    default:
      return null;
  }
}
