import type {
  Area,
  CalendarEvent,
  CalendarStatus,
  Label,
  Project,
  Task,
} from "../../shared/types";

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.status === 204 ? (undefined as T) : res.json<T>();
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
    http<Task>("/api/tasks", { method: "POST", body: JSON.stringify(b) }),
  updateTask: (id: string, b: Record<string, unknown>) =>
    http<Task>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  completeTask: (id: string, done = true) =>
    http(`/api/tasks/${id}/complete?done=${done ? 1 : 0}`, { method: "POST" }),
  rescheduleTask: (id: string, due_date: string | null, due_time?: string | null) =>
    http(`/api/tasks/${id}/reschedule`, {
      method: "POST",
      body: JSON.stringify({ due_date, due_time }),
    }),
  reorderTasks: (
    items: { id: string; position: number; board_column?: string; status?: string }[]
  ) => http("/api/tasks/reorder", { method: "POST", body: JSON.stringify(items) }),
  deleteTask: (id: string) => http(`/api/tasks/${id}`, { method: "DELETE" }),
  addSubtask: (taskId: string, title: string) =>
    http(`/api/tasks/${taskId}/subtasks`, {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  updateSubtask: (taskId: string, subId: string, b: { done?: boolean; title?: string }) =>
    http(`/api/tasks/${taskId}/subtasks/${subId}`, {
      method: "PATCH",
      body: JSON.stringify(b),
    }),

  // labels
  listLabels: () => http<Label[]>("/api/labels"),

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
