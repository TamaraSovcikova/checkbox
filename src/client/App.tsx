import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { Task } from "../shared/types";
import { fetchMe, api, type Me } from "./lib/api";
import { Sidebar } from "./components/Sidebar";
import { TaskDrawer } from "./components/TaskDrawer";
import { TaskUIContext, MeContext } from "./lib/ui-context";
import { AreaPage, LabelPage, ProjectPage, ViewPage, SettingsPage } from "./pages";
import CalendarPage from "./CalendarPage";

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false } },
});

// Brussels-local today as YYYY-MM-DD (matches the server's day boundary).
function todayStr(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Cross-surface drag: a task row dropped on an area/project/view node in the
// sidebar reassigns or reschedules it. Drop rules:
//   area    -> set area_id, clear project_id
//   project -> set project_id + its area_id
//   today   -> schedule for today (due_date = today)
//   backlog -> clear area_id + project_id
function Layout() {
  const [task, setTask] = useState<Task | null>(null);
  const client = useQueryClient();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  async function onDragEnd(e: DragEndEvent) {
    const dragged = e.active.data.current as { type?: string; task?: Task } | undefined;
    const target = e.over?.data.current as
      | { type?: string; areaId?: string; projectId?: string; view?: string }
      | undefined;
    if (!dragged?.task || !target) return;
    const id = dragged.task.id;

    try {
      if (target.type === "area") {
        await api.updateTask(id, { area_id: target.areaId, project_id: null });
      } else if (target.type === "project") {
        await api.updateTask(id, {
          project_id: target.projectId,
          area_id: target.areaId ?? null,
        });
      } else if (target.type === "view" && target.view === "today") {
        await api.rescheduleTask(id, todayStr());
      } else if (target.type === "view" && target.view === "backlog") {
        await api.updateTask(id, { area_id: null, project_id: null });
      } else {
        return;
      }
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
          <main className="flex-1 overflow-y-auto p-6">
            <Outlet />
          </main>
          {task && <TaskDrawer task={task} onClose={() => setTask(null)} />}
        </div>
      </DndContext>
    </TaskUIContext.Provider>
  );
}

function SignIn() {
  return (
    <div className="grid h-dvh place-items-center bg-slate-950 text-slate-100">
      <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center">
        <div className="mb-2 text-3xl">☑</div>
        <h1 className="mb-1 text-xl font-semibold">Checkbox</h1>
        <p className="mb-6 text-sm text-slate-400">
          Sign in to reach your tasks on any device.
        </p>
        <a
          href="/api/auth/google"
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-200"
        >
          <span>Continue with Google</span>
        </a>
        <p className="mt-4 text-xs text-slate-600">Checkbox is invite-only.</p>
      </div>
    </div>
  );
}

// Gate the whole app behind a session. Probes /api/auth/me once; logged-out
// users see the sign-in screen, logged-in users get the app + Me in context.
function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "out" | Me>("loading");
  useEffect(() => {
    fetchMe().then((me) => setState(me ?? "out"));
  }, []);
  if (state === "loading")
    return (
      <div className="grid h-dvh place-items-center bg-slate-950 text-slate-500">
        Loading…
      </div>
    );
  if (state === "out") return <SignIn />;
  return <MeContext.Provider value={state}>{children}</MeContext.Provider>;
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AuthGate>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/today" replace />} />
            <Route path="today" element={<ViewPage name="today" />} />
            <Route path="upcoming" element={<ViewPage name="upcoming" />} />
            <Route path="overdue" element={<ViewPage name="overdue" />} />
            <Route path="backlog" element={<ViewPage name="backlog" />} />
            <Route path="logbook" element={<ViewPage name="logbook" />} />
            <Route path="area/:id" element={<AreaPage />} />
            <Route path="project/:id" element={<ProjectPage />} />
            <Route path="label/:name" element={<LabelPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </AuthGate>
    </QueryClientProvider>
  );
}
