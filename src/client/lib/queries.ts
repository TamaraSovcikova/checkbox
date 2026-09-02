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
  SavedFilter,
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
// Every cache that holds task data, invalidated together after any task write.
//
// This list IS the contract, and it has to be exhaustive: a cache missing from it
// does not refresh, and a page reading it shows work that is no longer there.
// Deleting a task from a SAVED FILTER left the row on screen, still clickable,
// still opening a sheet for a task that no longer existed, until a manual reload.
// The filter page reads ["filter-tasks", id], which was in neither line above.
//
// The three below it are snapshots rather than live reads: a day plan block
// carries its own title and priority, and the weekly review and the stats
// carry counts and task refs taken at fetch time. None of them re-derive from
// ["tasks"], so none of them notice a deletion on their own.
//
// Pins are the exception that proves the rule: a pin line stores a task_id and
// reads the live task through ["tasks"], so it self-heals. Refreshed anyway,
// since the pin row itself can change server-side when its task goes.
//
// RULE for anything added later: if a query returns task titles, ids, dates or
// counts, its key belongs here. Over-invalidating costs a cheap refetch on a
// single-user app; under-invalidating costs trust in what the screen says.
const TASK_BEARING_KEYS = [
  ["view"],
  ["tasks"],
  ["filter-tasks"],
  ["day-plan"],
  ["review"],
  ["stats"],
  ["pins"],
  ["triage"],
] as const;

export function useTaskInvalidate() {
  const qc = useQueryClient();
  return () => {
    for (const queryKey of TASK_BEARING_KEYS)
      qc.invalidateQueries({ queryKey: queryKey as unknown as unknown[] });
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

// Reorder the sidebar's saved filters. Optimistic, because the arrows are held
// down repeatedly to walk a filter up a list and a round trip between each press
// would make the row appear to lag behind the clicks.
export function useReorderFilters() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: SavedFilter[]) =>
      api.reorderFilters(items.map((f, i) => ({ id: f.id, position: i }))),
    onMutate: async (items) => {
      await qc.cancelQueries({ queryKey: ["filters"] });
      const prev = qc.getQueryData<SavedFilter[]>(["filters"]);
      qc.setQueryData(
        ["filters"],
        items.map((f, i) => ({ ...f, position: i }))
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["filters"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["filters"] }),
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

// navigator.onLine LIES. It reports the OS/adapter's opinion, and Chrome has
// been observed flipping it to false while every request still succeeds (seen
// while a service worker was updating), which painted a permanent "offline"
// badge over a perfectly working app. So the browser's claim is only ever a
// PROMPT to check: a real request to our own origin decides. The reverse is
// cheap and safe, since a successful request proves connectivity outright.
async function reachable(): Promise<boolean> {
  try {
    const res = await fetch(`/api/health?_p=${Date.now()}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function useOnlineStatus() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const qc = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const drainQueue = () =>
      replayOfflineQueue(() => {
        qc.invalidateQueries({ queryKey: ["view"] });
        qc.invalidateQueries({ queryKey: ["tasks"] });
      })
        .then(getOfflineQueueLength)
        .then((n) => !cancelled && setPending(n));

    // Settle the badge against reality, and while genuinely offline keep
    // re-probing so it heals itself without needing an `online` event that
    // may never fire.
    const settle = async () => {
      const ok = await reachable();
      if (cancelled) return;
      setOnline(ok);
      if (ok) {
        drainQueue();
      } else {
        clearTimeout(retry);
        retry = setTimeout(settle, 20_000);
      }
    };

    getOfflineQueueLength().then((n) => !cancelled && setPending(n));
    settle();

    const onVisible = () => document.visibilityState === "visible" && settle();
    window.addEventListener("online", settle);
    window.addEventListener("offline", settle);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(retry);
      window.removeEventListener("online", settle);
      window.removeEventListener("offline", settle);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [qc]);

  return { online, pending };
}

// ── View preferences (hide/show + order) ──────────────────────────────────────

const EMPTY_PREFS: UserPrefs = { hiddenViews: [], viewOrder: [], viewDefaults: {} };

// A stored order that names only what has been MOVED.
//
// Everything it does not mention keeps the position the code gave it, which is
// the property that matters: a view or a section added to the app later appears
// where the app puts it, instead of being ranked by a list written before it
// existed. Stable, so two unmoved entries keep their relative order.
function applyPartialOrder<T>(
  items: T[],
  key: (x: T) => string,
  order: string[]
): T[] {
  if (!order.length) return items;
  const rank = (x: T) => {
    const i = order.indexOf(key(x));
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return items
    .map((v, i) => ({ v, i }))
    .sort((a, b) => rank(a.v) - rank(b.v) || a.i - b.i)
    .map((x) => x.v);
}

// Move one key one place within the list it is shown in. Returns null at either
// end rather than wrapping: wrapping from top to bottom on a nav list reads as a
// misclick, not as a feature.
function swap(within: string[], key: string, dir: -1 | 1): string[] | null {
  const i = within.indexOf(key);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= within.length) return null;
  const next = [...within];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

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

  // Sidebar ORDER. `viewOrder` has been in the prefs type and persisted by the
  // route since it was introduced, and nothing ever read it: hiding a view
  // worked, moving one did not. These close that.
  //
  // The stored list is partial on purpose. It names only the views that have
  // been moved; anything absent keeps its position in the code's own order,
  // which means a view added to the app later appears where the app puts it
  // rather than silently landing at the end of a list written months ago.
  const orderViews = <T extends { to: string }>(items: T[]): T[] =>
    applyPartialOrder(items, (v) => v.to, prefs.viewOrder ?? []);

  // The sidebar's SECTIONS (Tasks, Plan, Areas, Labels...), same rules as the
  // views inside them: partial, stable, and blind to sections that are not
  // currently showing.
  const orderSections = (ids: string[]): string[] =>
    applyPartialOrder(ids, (x) => x, prefs.sectionOrder ?? []);

  const moveSection = (id: string, dir: -1 | 1, within: string[]) => {
    const next = swap(within, id, dir);
    if (!next) return;
    const others = (prefs.sectionOrder ?? []).filter((v) => !within.includes(v));
    save.mutate({ ...prefs, sectionOrder: [...others, ...next] });
  };

  // Move a view one place within the list it is shown in. The whole list is
  // written back, not just the moved key: a partial order is only meaningful
  // relative to the neighbours it was computed against.
  const moveView = (viewKey: string, dir: -1 | 1, within: string[]) => {
    const next = swap(within, viewKey, dir);
    if (!next) return;
    // Keep any ordering already recorded for OTHER sections; this call only
    // speaks for the list it was given.
    const others = (prefs.viewOrder ?? []).filter((v) => !within.includes(v));
    save.mutate({ ...prefs, viewOrder: [...others, ...next] });
  };

  // The Home dashboard's layout. Undefined = never customised (the page
  // renders its default); [] = user removed everything, honoured as-is.
  const dashboard = prefs.dashboard;
  const setDashboard = (items: NonNullable<UserPrefs["dashboard"]>) =>
    save.mutate({ ...prefs, dashboard: items });

  // Cadence sections: the ORDER, plus any section created before it has
  // members. Membership lives on trackers.section (shared/cadenceSections).
  const cadenceSections = prefs.cadenceSections ?? [];
  const setCadenceSections = (names: string[]) =>
    save.mutate({ ...prefs, cadenceSections: names });

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
    orderViews,
    moveView,
    orderSections,
    moveSection,
    dashboard,
    setDashboard,
    cadenceSections,
    setCadenceSections,
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
