// Shared types between the Worker API and the React client.

export type Priority = 1 | 2 | 3 | 4; // 1 urgent .. 4 backlog
export type TaskStatus = "todo" | "doing" | "done";
export type ProjectStatus = "active" | "completed" | "archived";

export interface Area {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  position: number;
  archived_at: string | null;
}

export interface Project {
  id: string;
  area_id: string | null;
  name: string;
  description: string | null;
  goal: string | null;
  status: ProjectStatus;
  start_date: string | null;
  due_date: string | null;
  board_columns: string[];
  position: number;
  completed_at: string | null;
}

export interface Subtask {
  id: string;
  task_id: string;
  title: string;
  done: boolean;
  position: number;
}

export interface Label {
  id: string;
  name: string;
  color: string | null;
}

export interface Task {
  id: string;
  area_id: string | null;
  project_id: string | null;
  title: string;
  notes: string | null;
  priority: Priority;
  due_date: string | null; // YYYY-MM-DD
  due_time: string | null; // HH:MM
  time_estimate_min: number | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  board_column: string | null;
  section_id: string | null;
  parent_task_id: string | null;
  recurring_rule_id: string | null;
  recurrence: string | null; // compact spec, see shared/recurrence.ts
  recurrence_mode: "fixed" | "after_completion";
  position: number;
  status: TaskStatus;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  // joined
  labels?: Label[];
  subtasks?: Subtask[];
}

// A saved filter's query. Every field optional and ANDed together server-side.
export interface FilterQuery {
  text?: string;
  priority_max?: Priority;
  label?: string;
  area_id?: string;
  project_id?: string;
  due?: "overdue" | "today" | "week" | "none" | "any";
  status?: "open" | "done" | "any";
}

export interface SavedFilter {
  id: string;
  name: string;
  query: FilterQuery;
  position: number;
}

// Google Calendar event (from local cache).
export interface CalendarEvent {
  id: string;
  gcal_event_id: string;
  calendar_id: string;
  title: string | null;
  start: string; // UTC ISO or YYYY-MM-DD for all-day
  end: string;
  all_day: boolean;
  is_checkbox_owned: boolean;
  task_id: string | null;
}

export interface CalendarStatus {
  connected: boolean;
  google_email: string | null;
  primary_calendar_id: string | null;
}

export interface TriageSuggestion {
  id: string;
  task_id: string;
  task_title: string;
  suggested_area_id: string | null;
  suggested_project_id: string | null;
  area_name: string | null;
  project_name: string | null;
  confidence: number;
  reason: string;
  status: "pending" | "accepted" | "rejected";
}

// Per-view display defaults (grid vs list, sort key, group key), keyed by view.
export interface ViewDefault {
  mode?: "grid" | "list";
  sort?: string;
  group?: string;
}

// Per-user view preferences (stored as JSON on the users row).
export interface UserPrefs {
  hiddenViews: string[]; // view keys the user has hidden from the sidebar
  viewOrder: string[]; // optional custom ordering of view keys
  viewDefaults?: Record<string, ViewDefault>; // per-view grid/sort/group memory
}

// Payload from the NLP capture bar.
export interface CaptureParse {
  title: string;
  due_date: string | null;
  due_time: string | null;
  priority: Priority | null;
  labelNames: string[];
  projectName: string | null;
  recurrence: string | null; // compact spec, see shared/recurrence.ts
}
