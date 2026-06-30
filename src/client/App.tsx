import { useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Task } from "../shared/types";
import { Sidebar } from "./components/Sidebar";
import { TaskDrawer } from "./components/TaskDrawer";
import { TaskUIContext } from "./lib/ui-context";
import { AreaPage, LabelPage, ProjectPage, ViewPage } from "./pages";

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false } },
});

function Layout() {
  const [task, setTask] = useState<Task | null>(null);
  return (
    <TaskUIContext.Provider value={{ open: setTask }}>
      <div className="flex h-dvh">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
        {task && <TaskDrawer task={task} onClose={() => setTask(null)} />}
      </div>
    </TaskUIContext.Provider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
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
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
