import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { format, addDays, parseISO } from "date-fns";
import { api } from "./api";
import type {
  FilterQuery,
  Task,
  UserPrefs,
  ViewDefault,
} from "../../shared/types";
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

// Resolve specific tasks by id, INCLUDING done ones (the plain list hides those).
// Used by pins to render their linked tasks: a linked task that gets ticked off
// must stay on the pin, ticked, rather than vanish as if it had been deleted.
export const useTasksByIds = (ids: string[]) => {
  // Sorted + joined so the key is stable regardless of the order they were added.
  const key = [...ids].sort().join(",");
  return useQuery({
    queryKey: ["tasks", { ids: key }],
    queryFn: () => api.listTasks({ ids: key }),
    enabled: ids.length > 0,
  });
};

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

// Tick a subtask from anywhere (the task row's inline list, or the sheet).
// Ticking one promotes the parent todo -> doing server-side, so invalidate the
// task lists rather than patching a single row.
export function useToggleSubtask() {
  const invalidate = useTaskInvalidate();
  return useMutation({
    mutationFn: ({
      taskId,
      subId,
      done,
    }: {
      taskId: string;
      subId: string;
      done: boolean;
    }) => api.updateSubtask(taskId, subId, { done }),
    onSuccess: invalidate,
  });
}

export function useCompleteAllSubtasks() {
  const invalidate = useTaskInvalidate();
  return useMutation({
    mutationFn: (taskId: string) => api.completeAllSubtasks(taskId),
    onSuccess: invalidate,
  });
}

export function useSnoozeTask() {
  const invalidate = useTaskInvalidate();
  return useMutation({
    mutationFn: ({ id, until }: { id: string; until: string | null }) =>
      api.snoozeTask(id, until),
    onSuccess: invalidate,
  });
}

// ── Progress + weekly review ────────────────────────────────────────────────

export const useStats = () =>
  useQuery({ queryKey: ["stats"], queryFn: api.stats, staleTime: 30_000 });

export const useReview = () =>
  useQuery({ queryKey: ["review"], queryFn: api.review, staleTime: 30_000 });

// ── Note→task extraction (#31) ──────────────────────────────────────────────

export const useNoteCandidates = () =>
  useQuery({
    queryKey: ["note-candidates"],
    queryFn: api.noteCandidates,
    staleTime: 15_000,
  });

export function useAcceptNoteCandidate() {
  const qc = useQueryClient();
  const invalidate = useTaskInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.acceptNoteCandidate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["note-candidates"] });
      invalidate();
    },
  });
}

export function useRejectNoteCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.rejectNoteCandidate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["note-candidates"] }),
  });
}

export function useAddNoteCandidates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      candidates: Parameters<typeof api.addNoteCandidates>[0]
    ) => api.addNoteCandidates(candidates),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["note-candidates"] }),
  });
}

// ── Gmail coverage (Phase A) ─────────────────────────────────────────────────

export const useMailCandidates = (days = 7) =>
  useQuery({
    queryKey: ["mail-candidates", days],
    queryFn: () => api.mailCandidates(days),
    staleTime: 15_000,
  });

export function useMailAccept() {
  const qc = useQueryClient();
  const invalidate = useTaskInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.mailAccept(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mail-candidates"] });
      invalidate();
    },
  });
}

export function useMailDismiss() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.mailDismiss(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mail-candidates"] }),
  });
}

// ── Gmail live sync (Phase B) ────────────────────────────────────────────────

export const useGmailStatus = () =>
  useQuery({ queryKey: ["gmail-status"], queryFn: api.gmailStatus, staleTime: 30_000 });

export function useGmailRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.gmailRefresh(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mail-candidates"] });
      qc.invalidateQueries({ queryKey: ["gmail-status"] });
    },
  });
}

// ── Cadence trackers ─────────────────────────────────────────────────────────

export const useTrackers = () =>
  useQuery({ queryKey: ["trackers"], queryFn: api.trackers, staleTime: 30_000 });

const invalidateTrackers = (qc: ReturnType<typeof useQueryClient>) => () =>
  qc.invalidateQueries({ queryKey: ["trackers"] });

export function useCreateTracker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: Parameters<typeof api.createTracker>[0]) => api.createTracker(b),
    onSuccess: invalidateTrackers(qc),
  });
}

export function useUpdateTracker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<import("../../shared/types").Tracker> }) =>
      api.updateTracker(id, body),
    onSuccess: invalidateTrackers(qc),
  });
}

export function useDeleteTracker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTracker(id),
    onSuccess: invalidateTrackers(qc),
  });
}

// The button that resets the counter. Returns the event id so the caller can
// offer a precise undo.
export function useLogTracker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, occurred_at }: { id: string; occurred_at?: string }) =>
      api.logTracker(id, occurred_at ? { occurred_at } : undefined),
    onSuccess: invalidateTrackers(qc),
  });
}

export function useUnlogTracker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, eventId }: { id: string; eventId: string }) =>
      api.unlogTracker(id, eventId),
    onSuccess: invalidateTrackers(qc),
  });
}

// ── Pins ─────────────────────────────────────────────────────────────────────

export const usePins = () =>
  useQuery({ queryKey: ["pins"], queryFn: api.pins, staleTime: 30_000 });

export function useCreatePin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: Partial<import("../../shared/types").Pin>) => api.createPin(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pins"] }),
  });
}

export function useUpdatePin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Partial<import("../../shared/types").Pin>;
    }) => api.updatePin(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pins"] }),
  });
}

export function useDeletePin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePin(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pins"] }),
  });
}

// ── Ambient day plan (#30) ──────────────────────────────────────────────────

export const useDayPlan = () =>
  useQuery({ queryKey: ["day-plan"], queryFn: api.dayPlanToday, staleTime: 30_000 });

export function useAcceptDayPlan() {
  const qc = useQueryClient();
  const invalidate = useTaskInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.dayPlanAccept(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["day-plan"] });
      invalidate();
    },
  });
}

export function useDismissDayPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.dayPlanDismiss(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["day-plan"] }),
  });
}

// ── Templates ───────────────────────────────────────────────────────────────

export const useTemplates = () =>
  useQuery({ queryKey: ["templates"], queryFn: api.listTemplates, staleTime: 60_000 });

export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<import("../../shared/types").Template> }) =>
      id ? api.updateTemplate(id, body) : api.createTemplate(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });
}

export function useApplyTemplate() {
  const invalidate = useTaskInvalidate();
  return useMutation({
    mutationFn: ({
      id,
      anchor,
      area_id,
      project_id,
    }: {
      id: string;
      anchor?: string;
      area_id?: string | null;
      project_id?: string | null;
    }) => api.applyTemplate(id, { anchor, area_id, project_id }),
    onSuccess: invalidate,
  });
}

// ── Attachments ─────────────────────────────────────────────────────────────

export const useAttachments = (taskId: string | null) =>
  useQuery({
    queryKey: ["attachments", taskId],
    queryFn: () => api.listAttachments(taskId!),
    enabled: !!taskId,
  });

// ── Saved filters ──────────────────────────────────────────────────────────────

export const useSavedFilters = () =>
  useQuery({ queryKey: ["filters"], queryFn: api.listFilters, staleTime: 60_000 });

export const useFilterTasks = (id: string) =>
  useQuery({
    queryKey: ["filter-tasks", id],
    queryFn: () => api.filterTasks(id),
  });

export function useCreateFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { name: string; query: FilterQuery }) => api.createFilter(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["filters"] }),
  });
}

export function useUpdateFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; query?: FilterQuery } }) =>
      api.updateFilter(id, body),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ["filters"] });
      qc.invalidateQueries({ queryKey: ["filter-tasks", id] });
    },
  });
}

export function useDeleteFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteFilter(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["filters"] }),
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
    mutationFn: ({
      id,
      dest,
    }: {
      id: string;
      dest?: { area_id?: string | null; project_id?: string | null };
    }) => api.triageAccept(id, dest),
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

const EMPTY_PREFS: UserPrefs = { hiddenViews: [], viewOrder: [], viewDefaults: {} };

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

  // The Home dashboard's layout. Undefined = never customised (the page
  // renders its default); [] = user removed everything, honoured as-is.
  const dashboard = prefs.dashboard;
  const setDashboard = (items: NonNullable<UserPrefs["dashboard"]>) =>
    save.mutate({ ...prefs, dashboard: items });

  // Per-view display defaults (grid/sort/group). Merges into the same prefs blob
  // so a write never drops hiddenViews/viewOrder.
  const viewDefault = (viewKey: string): ViewDefault =>
    prefs.viewDefaults?.[viewKey] ?? {};
  const setViewDefault = (viewKey: string, patch: Partial<ViewDefault>) => {
    const cur = prefs.viewDefaults?.[viewKey] ?? {};
    save.mutate({
      ...prefs,
      viewDefaults: {
        ...(prefs.viewDefaults ?? {}),
        [viewKey]: { ...cur, ...patch },
      },
    });
  };

  // Catch-all area used by backlog triage when nothing matches confidently.
  const setTriageFallbackArea = (areaId: string | null) =>
    save.mutate({ ...prefs, triageFallbackAreaId: areaId });

  // Dim tasks due more than a month out. Default on (undefined ⇒ true).
  const dimDistantTasks = prefs.dimDistantTasks !== false;
  const setDimDistantTasks = (on: boolean) =>
    save.mutate({ ...prefs, dimDistantTasks: on });

  // What syncs to Google Calendar. Both default on.
  const gcalSyncTimeBlocks = prefs.gcalSyncTimeBlocks !== false;
  const gcalSyncDueDates = prefs.gcalSyncDueDates !== false;
  const setGcalSync = (patch: Partial<UserPrefs>) =>
    save.mutate({ ...prefs, ...patch });

  // All-day Google entries hidden from the Calendar page, by title.
  const hiddenAllDayTitles = prefs.hiddenAllDayTitles ?? [];
  const isAllDayHidden = (title: string) => hiddenAllDayTitles.includes(title);
  const toggleAllDayTitle = (title: string) =>
    save.mutate({
      ...prefs,
      hiddenAllDayTitles: hiddenAllDayTitles.includes(title)
        ? hiddenAllDayTitles.filter((t) => t !== title)
        : [...hiddenAllDayTitles, title],
    });

  // The read-only day timeline beside Today. On by default (undefined ⇒ true),
  // so seeing how the day is scheduled is the default rather than a setting you
  // have to discover; only an explicit false hides it. Matches the sense of
  // dimDistantTasks / the gcal-sync prefs above.
  const todayCalendar = prefs.todayCalendar !== false;
  const setTodayCalendar = (on: boolean) =>
    save.mutate({ ...prefs, todayCalendar: on });

  // Compact cadence strip under the Today timeline. Off by default.
  const todayCadences = prefs.todayCadences === true;
  const setTodayCadences = (on: boolean) =>
    save.mutate({ ...prefs, todayCadences: on });

  return {
    prefs,
    hide,
    show,
    isHidden,
    dashboard,
    setDashboard,
    viewDefault,
    setViewDefault,
    setTriageFallbackArea,
    dimDistantTasks,
    setDimDistantTasks,
    gcalSyncTimeBlocks,
    gcalSyncDueDates,
    setGcalSync,
    hiddenAllDayTitles,
    isAllDayHidden,
    toggleAllDayTitle,
    todayCalendar,
    setTodayCalendar,
    todayCadences,
    setTodayCadences,
  };
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

// Events across an arbitrary [start, endExclusive) range: powers the week view.
// The API + route already accept start/end; this just widens the window.
export const useCalendarRange = (startStr: string, endStr: string) =>
  useQuery({
    queryKey: ["calendar", "events", startStr, endStr],
    queryFn: () => api.calendarEvents(startStr, endStr),
    staleTime: 30_000,
  });

export function useCalendarSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.calendarSync,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar", "events"] });
      qc.invalidateQueries({ queryKey: ["calendar", "feeds"] });
    },
  });
}

export const useCalendarFeeds = (enabled = true) =>
  useQuery({
    queryKey: ["calendar", "feeds"],
    queryFn: api.calendarFeeds,
    enabled,
    staleTime: 60_000,
  });

export function useSetCalendarFeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.setCalendarFeed(id, enabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar", "feeds"] });
      qc.invalidateQueries({ queryKey: ["calendar", "events"] });
    },
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
