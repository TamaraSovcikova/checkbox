import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fetchMe, type Me } from "./lib/api";
import { AppShell } from "./AppShell";
import { MeContext } from "./lib/ui-context";
import { ToastProvider } from "./lib/toast";
import {
  AreaPage,
  LabelPage,
  ProjectPage,
  ViewPage,
  SettingsPage,
  FilterPage,
  ReviewPage,
} from "./pages";

// Lazy — the calendar pulls in its own timeline code; keep it out of the
// initial bundle (capture-first PWA).
const CalendarPage = lazy(() => import("./CalendarPage"));

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false } },
});

function SignIn() {
  return (
    <div className="grid h-dvh place-items-center bg-background text-foreground">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface/60 p-8 text-center">
        <div className="mb-2 text-3xl">☑</div>
        <h1 className="mb-1 text-xl font-semibold">Checkbox</h1>
        <p className="mb-6 text-sm text-muted">
          Sign in to reach your tasks on any device.
        </p>
        <a
          href="/api/auth/google"
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-200"
        >
          <span>Continue with Google</span>
        </a>
        <p className="mt-4 text-xs text-subtle">Checkbox is invite-only.</p>
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
      <div className="grid h-dvh place-items-center bg-background text-muted">
        Loading…
      </div>
    );
  if (state === "out") return <SignIn />;
  return <MeContext.Provider value={state}>{children}</MeContext.Provider>;
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
      <AuthGate>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<Navigate to="/today" replace />} />
              <Route path="today" element={<ViewPage name="today" />} />
              <Route path="upcoming" element={<ViewPage name="upcoming" />} />
              <Route path="overdue" element={<ViewPage name="overdue" />} />
              <Route path="backlog" element={<ViewPage name="backlog" />} />
              <Route path="logbook" element={<ViewPage name="logbook" />} />
              <Route path="snoozed" element={<ViewPage name="snoozed" />} />
              <Route path="review" element={<ReviewPage />} />
              <Route path="area/:id" element={<AreaPage />} />
              <Route path="project/:id" element={<ProjectPage />} />
              <Route path="label/:name" element={<LabelPage />} />
              <Route path="filter/:id" element={<FilterPage />} />
              <Route
                path="calendar"
                element={
                  <Suspense
                    fallback={
                      <div className="py-24 text-center text-sm text-subtle">
                        Loading…
                      </div>
                    }
                  >
                    <CalendarPage />
                  </Suspense>
                }
              />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthGate>
      </ToastProvider>
    </QueryClientProvider>
  );
}
