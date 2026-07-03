import { useState } from "react";
import { Outlet } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { Task } from "../shared/types";
import { api } from "./lib/api";
import { resolveDrop, type DragData, type DropData } from "./lib/dnd";
import { Sidebar } from "./components/Sidebar";
import { TaskSheet } from "./components/TaskSheet";
import { CommandCapture } from "./components/CommandCapture";
import { TaskUIContext } from "./lib/ui-context";

// Brussels-local today as YYYY-MM-DD (matches the server's day boundary).
function todayStr(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// The app shell: sidebar + scrollable content region + ONE app-level DndContext.
// A single onDragEnd routes each drop by the droppable's declared type. Sidebar
// reassignment lands here today; the board and calendar surfaces fold their
// droppables into this same context at T7 (removing their nested contexts).
//
//   drag a task ──▶ over droppable.data.type
//                     ├── "area"    -> set area_id, clear project_id
//                     ├── "project" -> set project_id + its area_id
//                     ├── "view:today"   -> schedule for today
//                     └── "view:backlog" -> clear area_id + project_id
export function AppShell() {
  const [task, setTask] = useState<Task | null>(null);
  const client = useQueryClient();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  async function onDragEnd(e: DragEndEvent) {
    const action = resolveDrop(
      e.active.data.current as DragData,
      e.over?.data.current as DropData,
      todayStr()
    );
    if (!action) return;
    try {
      if (action.kind === "reschedule")
        await api.rescheduleTask(action.id, action.dueDate);
      else await api.updateTask(action.id, action.body);
    } finally {
      client.invalidateQueries({ queryKey: ["view"] });
      client.invalidateQueries({ queryKey: ["tasks"] });
    }
  }

  return (
    <TaskUIContext.Provider value={{ open: setTask }}>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex h-dvh">
          <Sidebar />
          <main className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              <Outlet />
            </div>
          </main>
          <TaskSheet task={task} onClose={() => setTask(null)} />
          <CommandCapture />
        </div>
      </DndContext>
    </TaskUIContext.Provider>
  );
}
