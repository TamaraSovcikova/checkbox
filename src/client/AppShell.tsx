import { useState, useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { Project, Task } from "../shared/types";
import { api } from "./lib/api";
import {
  resolveDrop,
  computeProjectReorder,
  type DragData,
  type DropData,
} from "./lib/dnd";
import { Sidebar, MobileSidebar } from "./components/Sidebar";
import { TaskSheet } from "./components/TaskSheet";
import { CommandCapture } from "./components/CommandCapture";
import { SearchIconButton } from "./components/SearchBox";
import { TaskUIContext } from "./lib/ui-context";
import { MenuIcon, AddIcon, LogoIcon } from "./lib/icons";
import { todayStr } from "./lib/utils";
import { ThemeToggle } from "./components/ThemeToggle";

// Fire the global capture surface (CommandCapture listens). Touch clients have no
// Cmd-K, so the mobile header button and the FAB both dispatch this.
function openCapture() {
  window.dispatchEvent(new Event("checkbox:capture"));
}

// The home-screen "Add task" shortcut opens the app at /?quickadd=1: open the
// capture surface once, then strip the param so refresh/back do not re-open it.
// (The manifest shortcut existed before anything handled the param.)
function useQuickAddParam() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("quickadd") !== "1") return;
    url.searchParams.delete("quickadd");
    window.history.replaceState({}, "", url.toString());
    // CommandCapture mounts in this same tree; give it a tick to attach.
    setTimeout(openCapture, 150);
  }, []);
}

// The app shell: sidebar + scrollable content region + ONE app-level DndContext.
// A single onDragEnd routes each drop by the droppable's declared type. Sidebar
// reassignment lands here today; the board and calendar surfaces fold their
// droppables into this same context at T7 (removing their nested contexts).
//
//   drag a task ──▶ over droppable.data.type
//                     ├── "area"    -> set area_id, clear project_id
//                     ├── "project" -> set project_id + its area_id
//                     ├── "view:today"   -> plan it for today (planned_date)
//                     └── "view:backlog" -> clear area_id + project_id
export function AppShell() {
  useQuickAddParam();
  const [task, setTask] = useState<Task | null>(null);
  const [drawer, setDrawer] = useState(false);
  const client = useQueryClient();
  // Mouse: a 6px move starts a drag, so a plain click still opens the task.
  // Touch: press-and-hold ~180ms starts a drag, so a normal swipe scrolls the
  // list instead of being hijacked. Without the TouchSensor, dragging was
  // impossible on the phone, the app's primary surface.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    })
  );

  async function onDragEnd(e: DragEndEvent) {
    const action = resolveDrop(
      e.active.data.current as DragData,
      e.over?.data.current as DropData,
      todayStr()
    );
    if (!action) return;
    try {
      if (action.kind === "move-project") {
        await api.updateProject(action.id, { area_id: action.areaId });
      } else if (action.kind === "reorder-project") {
        // The ordered list lives in the projects query, but under whichever key
        // the current page used (`["projects","all"]` or `["projects",<areaId>]`).
        // Gather every cached projects list and dedupe, so the reorder does not
        // depend on which page you happen to be on.
        const seen = new Map<string, Project>();
        for (const [, list] of client.getQueriesData<Project[]>({
          queryKey: ["projects"],
        })) {
          for (const p of list ?? []) if (!seen.has(p.id)) seen.set(p.id, p);
        }
        const positions = computeProjectReorder(
          [...seen.values()],
          action.id,
          action.overId
        );
        if (positions.length) {
          // Optimistic: renumber every cached projects list right away, so the
          // cards settle into their new order on drop instead of after the round
          // trip. The finally-block invalidate reconciles with the server.
          const byId = new Map(positions.map((p) => [p.id, p.position]));
          client.setQueriesData<Project[]>({ queryKey: ["projects"] }, (list) =>
            list
              ? [...list]
                  .map((p) => (byId.has(p.id) ? { ...p, position: byId.get(p.id)! } : p))
                  .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
              : list
          );
          await api.reorderProjects(positions);
        }
      } else if (action.kind === "complete") {
        await api.completeTask(action.id, action.done);
        if (action.then) await api.updateTask(action.id, action.then);
      } else {
        await api.updateTask(action.id, action.body);
      }
    } finally {
      client.invalidateQueries({ queryKey: ["view"] });
      client.invalidateQueries({ queryKey: ["tasks"] });
      client.invalidateQueries({ queryKey: ["projects"] });
    }
  }

  return (
    <TaskUIContext.Provider value={{ open: setTask }}>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex h-dvh">
          {/* Desktop rail (hidden < md); the drawer takes over on mobile. */}
          <Sidebar />
          <MobileSidebar open={drawer} onOpenChange={setDrawer} />

          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* Mobile-only top app bar: hamburger + wordmark + quick add.
                Non-scrolling; the per-view TopBar sticks below it inside the
                scroll region and keeps its title/tabs/actions. */}
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface/60 px-3 md:hidden">
              <button
                type="button"
                aria-label="Open menu"
                onClick={() => setDrawer(true)}
                className="grid h-9 w-9 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <MenuIcon className="h-5 w-5" />
              </button>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <LogoIcon className="h-5 w-5 shrink-0 text-primary" />
                <span className="font-semibold tracking-tight text-foreground">
                  Checkbox
                </span>
              </div>
              <SearchIconButton />
              <ThemeToggle />
              <button
                type="button"
                aria-label="Add task"
                onClick={openCapture}
                className="grid h-9 w-9 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <AddIcon className="h-5 w-5" />
              </button>
            </header>

            {/* No top padding: the sticky TopBar bleeds flush to the top of the
                scroll region and supplies its own top padding. A top padding here
                would collapse with the header's margins and push content under the
                pinned bar (header-less pages add their own pt). */}
            {/* Mobile bottom padding clears the capture FAB (56px + offset), so
                the last row's controls are never stuck underneath it at the end
                of the scroll. Desktop has no FAB and keeps the tighter pad. */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-24 md:px-6 md:pb-6">
              <Outlet />
            </div>
          </main>

          {/* Capture FAB: thumb-reachable on mobile (capture-first PWA).
              Hidden on desktop where Cmd-K / the header input suffice. */}
          <button
            type="button"
            aria-label="Add task"
            onClick={openCapture}
            className="fixed bottom-6 right-5 z-30 grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-black/30 transition-transform active:scale-95 md:hidden"
            style={{ marginBottom: "env(safe-area-inset-bottom)" }}
          >
            <AddIcon className="h-6 w-6" />
          </button>

          <TaskSheet task={task} onClose={() => setTask(null)} />
          <CommandCapture />
        </div>
      </DndContext>
    </TaskUIContext.Provider>
  );
}
