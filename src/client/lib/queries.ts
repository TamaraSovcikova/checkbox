import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { format, addDays, parseISO } from "date-fns";
import { api } from "./api";
import type { Task, UserPrefs } from "../../shared/types";
import {
  getOfflineQueueLength,
  replayOfflineQueue,
} from "./offline";

export const useAreas = () =>
  useQuery({ queryKey: ["areas"], queryFn: api.listAreas });

export const useLabels = () =>
  useQuery({ queryKey: ["labels"], queryFn: api.listLabels });

export const useProjects = (areaId?: string) =>
  useQuery({
    queryKey: ["projects", areaId ?? "all"],
    queryFn: () => api.listProjects(areaId),
  });

export const useView = (name: string) =>
  useQuery({ queryKey: ["view", name], queryFn: () => api.view(name) });

export const useTasks = (params: Record<string, string>) =>
  useQuery({
    queryKey: ["tasks", params],
    queryFn: () => api.listTasks(params),
  });

// Invalidate everything task-shaped after a write (cheap for a personal app).
export function useTaskInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["view"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
  };
}

export function useCreateTask() {
  const invalidate = useTaskInvalidate();
  return useMutation({
    mutationFn: (b: Record<string, unknown>) => api.createTask(b),
    onSuccess: invalidate,
  });
}

export function useCompleteTask() {
  const invalidate = useTaskInvalidate();
  return useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      api.completeTask(id, done),
    onSuccess: invalidate,
  });
}

export function useUpdateTask() {
  const invalidate = useTaskInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.updateTask(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteTask() {
  const invalidate = useTaskInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.deleteTask(id),
    onSuccess: invalidate,
  });
}

// ── Triage ────────────────────────────────────────────────────────────────────

export const useTriageSuggestions = () =>
  useQuery({ queryKey: ["triage"], queryFn: api.triageList, staleTime: 30_000 });

export function useTriageGenerate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.triageGenerate,
    onSuccess: (data) => qc.setQueryData(["triage"], data),
  });
}

export function useTriageAccept() {
  const qc = useQueryClient();
  const invalidate = useTaskInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.triageAccept(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["triage"] });
      invalidate();
    },
  });
}

export function useTriageReject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.triageReject(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["triage"] }),
  });
}

// ── Push ──────────────────────────────────────────────────────────────────────

export const usePushStatus = () =>
  useQuery({
    queryKey: ["push", "status"],
    queryFn: api.pushStatus,
    staleTime: 60_000,
  });

// ── Offline ───────────────────────────────────────────────────────────────────

export function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const qc = useQueryClient();

  useEffect(() => {
    getOfflineQueueLength().then(setPending);

    const onOnline = () => {
      setOnline(true);
      replayOfflineQueue(() => {
        qc.invalidateQueries({ queryKey: ["view"] });
        qc.invalidateQueries({ queryKey: ["tasks"] });
      }).then(getOfflineQueueLength).then(setPending);
    };
    const onOffline = () => {
      setOnline(false);
      getOfflineQueueLength().then(setPending);
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [qc]);

  return { online, pending };
}

// ── View preferences (hide/show + order) ──────────────────────────────────────

const EMPTY_PREFS: UserPrefs = { hiddenViews: [], viewOrder: [] };

export function useViewPrefs() {
  const qc = useQueryClient();
  const { data: prefs = EMPTY_PREFS } = useQuery({
    queryKey: ["prefs"],
    queryFn: api.getPrefs,
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: (p: UserPrefs) => api.savePrefs(p),
    // Optimistic: update the cache immediately so the sidebar reacts at once.
    onMutate: async (p) => {
      await qc.cancelQueries({ queryKey: ["prefs"] });
      const prev = qc.getQueryData<UserPrefs>(["prefs"]);
      qc.setQueryData(["prefs"], p);
      return { prev };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(["prefs"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["prefs"] }),
  });

  const hide = (viewKey: string) => {
    if (prefs.hiddenViews.includes(viewKey)) return;
    save.mutate({ ...prefs, hiddenViews: [...prefs.hiddenViews, viewKey] });
  };
  const show = (viewKey: string) => {
    save.mutate({
      ...prefs,
      hiddenViews: prefs.hiddenViews.filter((v) => v !== viewKey),
    });
  };
  const isHidden = (viewKey: string) => prefs.hiddenViews.includes(viewKey);

  return { prefs, hide, show, isHidden };
}

// ── Calendar ──────────────────────────────────────────────────────────────────

export const useCalendarStatus = () =>
  useQuery({
    queryKey: ["calendar", "status"],
    queryFn: api.calendarStatus,
    staleTime: 60_000,
  });

export const useCalendarEvents = (dateStr: string) => {
  const endStr = format(addDays(parseISO(dateStr), 1), "yyyy-MM-dd");
  return useQuery({
    queryKey: ["calendar", "events", dateStr],
    queryFn: () => api.calendarEvents(dateStr, endStr),
    staleTime: 30_000,
  });
};

export function useCalendarSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.calendarSync,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["calendar", "events"] }),
  });
}

// ── Shared ────────────────────────────────────────────────────────────────────

export const PRIORITY_LABEL: Record<number, string> = {
  1: "P1 urgent",
  2: "P2 this week",
  3: "P3 flexible",
  4: "P4 backlog",
};

export function sortTasks(a: Task, b: Task) {
  return a.priority - b.priority;
}
