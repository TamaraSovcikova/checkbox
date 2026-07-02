import type {
  Area,
  CalendarEvent,
  CalendarStatus,
  Label,
  Project,
  Task,
  TriageSuggestion,
  UserPrefs,
} from "../../shared/types";
import { enqueueOffline } from "./offline";

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "content-type": "application/json" },
    credentials: "include",
    ...init,
  });
  // Session expired or missing mid-use — bounce to Google login. The auth
  // endpoints themselves are exempt so the AuthGate can probe /me quietly.
  if (res.status === 401 && !url.startsWith("/api/auth/")) {
    window.location.href = "/api/auth/google";
    throw new Error("401 — redirecting to login");
  }
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.status === 204 ? (undefined as T) : res.json<T>();
}

export type Me = {
  userId: string;
  email: string;
  name: string | null;
  avatar: string | null;
};

// Probe the session without triggering the redirect. Returns null when logged out.
export async function fetchMe(): Promise<Me | null> {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  return res.ok ? res.json<Me>() : null;
}

// Mutations that fail because we're offline are queued for later replay.
async function httpMutate<T>(
  method: string,
  url: string,
  body?: unknown
): Promise<T> {
  const init: RequestInit = {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
  try {
    return await http<T>(url, init);
  } catch (e) {
    if (!navigator.onLine) {
      await enqueueOffline(method, url, body);
      return undefined as T;
    }
    throw e;
  }
}

export const api = {
  // areas
  listAreas: () => http<Area[]>("/api/areas"),
  createArea: (b: Partial<Area>) =>
    http<Area>("/api/areas", { method: "POST", body: JSON.stringify(b) }),
  updateArea: (id: string, b: Partial<Area>) =>
    http<Area>(`/api/areas/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteArea: (id: string) =>
    http(`/api/areas/${id}`, { method: "DELETE" }),

  // projects
  listProjects: (areaId?: string) =>
    http<Project[]>(`/api/projects${areaId ? `?area_id=${areaId}` : ""}`),
  createProject: (b: Partial<Project>) =>
    http<Project>("/api/projects", { method: "POST", body: JSON.stringify(b) }),
  updateProject: (id: string, b: Partial<Project>) =>
    http<Project>(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(b),
    }),
  completeProject: (id: string) =>
    http(`/api/projects/${id}/complete`, { method: "POST" }),

  // tasks
  listTasks: (params: Record<string, string> = {}) =>
    http<Task[]>(`/api/tasks?${new URLSearchParams(params)}`),
  view: (name: string) => http<Task[]>(`/api/views/${name}`),
  getTask: (id: string) => http<Task>(`/api/tasks/${id}`),
  createTask: (b: Record<string, unknown>) =>
    httpMutate<Task>("POST", "/api/tasks", b),
  updateTask: (id: string, b: Record<string, unknown>) =>
    httpMutate<Task>("PATCH", `/api/tasks/${id}`, b),
  completeTask: (id: string, done = true) =>
    httpMutate("POST", `/api/tasks/${id}/complete?done=${done ? 1 : 0}`),
  rescheduleTask: (id: string, due_date: string | null, due_time?: string | null) =>
    httpMutate("POST", `/api/tasks/${id}/reschedule`, { due_date, due_time }),
  reorderTasks: (
    items: { id: string; position: number; board_column?: string; status?: string }[]
  ) => httpMutate("POST", "/api/tasks/reorder", items),
  deleteTask: (id: string) =>
    httpMutate("DELETE", `/api/tasks/${id}`),
  addSubtask: (taskId: string, title: string) =>
    httpMutate("POST", `/api/tasks/${taskId}/subtasks`, { title }),
  updateSubtask: (taskId: string, subId: string, b: { done?: boolean; title?: string }) =>
    httpMutate("PATCH", `/api/tasks/${taskId}/subtasks/${subId}`, b),

  // labels
  listLabels: () => http<Label[]>("/api/labels"),

  // triage
  triageGenerate: () =>
    http<TriageSuggestion[]>("/api/triage/generate", { method: "POST" }),
  triageList: () => http<TriageSuggestion[]>("/api/triage"),
  triageAccept: (id: string) =>
    http(`/api/triage/${id}/accept`, { method: "POST" }),
  triageReject: (id: string) =>
    http(`/api/triage/${id}/reject`, { method: "POST" }),

  // push notifications
  pushVapidKey: () => http<{ key: string }>("/api/push/vapid-public-key"),
  pushStatus: () =>
    http<{ configured: boolean; subscriptions: number }>("/api/push/status"),
  pushSubscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    http<{ ok: boolean }>("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify(sub),
    }),
  pushUnsubscribe: (endpoint: string) =>
    http<{ ok: boolean }>("/api/push/subscribe", {
      method: "DELETE",
      body: JSON.stringify({ endpoint }),
    }),

  // auth
  me: () => fetchMe(),
  logout: () => http("/api/auth/logout", { method: "POST" }),

  // prefs (view visibility/order) + MCP token
  getPrefs: () => http<UserPrefs>("/api/prefs"),
  savePrefs: (p: UserPrefs) =>
    http<UserPrefs>("/api/prefs", { method: "PUT", body: JSON.stringify(p) }),
  mcpToken: () => http<{ token: string }>("/api/prefs/mcp-token"),
  mcpTokenRotate: () =>
    http<{ token: string }>("/api/prefs/mcp-token", { method: "POST" }),

  // calendar
  calendarStatus: () => http<CalendarStatus>("/api/calendar/status"),
  calendarEvents: (start: string, end: string) =>
    http<CalendarEvent[]>(
      `/api/calendar/events?${new URLSearchParams({ start, end })}`
    ),
  calendarSync: () =>
    http<{ ok: boolean }>("/api/calendar/sync", { method: "POST" }),
  calendarDisconnect: () =>
    http("/api/calendar/disconnect", { method: "DELETE" }),
};
