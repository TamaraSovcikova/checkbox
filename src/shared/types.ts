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
  // Look of this area's own page. `palette` is a key from client/lib/theme.ts,
  // null meaning "follow the app"; `banner` is an https image URL, or our own
  // /api/areas/<id>/banner when the image was uploaded.
  palette: string | null;
  banner: string | null;
}

export interface Project {
  id: string;
  area_id: string | null;
  name: string;
  description: string | null;
  goal: string | null;
  status: ProjectStatus;
  starred: number; // 0/1 (D1 boolean): surfaces in the sidebar's Starred section
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
  due_date: string | null; // YYYY-MM-DD
  priority: Priority | null; // 1 urgent .. 4 backlog; null = unranked
}

export interface Label {
  id: string;
  name: string;
  color: string | null;
}

// A cadence tracker: something where the question is "how long since?" rather
// than "when is it due?". See migration 0026 for why these are not tasks.
export interface Tracker {
  id: string;
  name: string;
  kind: string; // contact | habit | maintenance | health (label only)
  // The section heading this tracker sits under on the Cadences page, or null
  // for ungrouped. A NAME, not a key: see migration 0033.
  section: string | null;
  target_days: number | null; // null = count it, but do not judge it
  area_id: string | null;
  notes: string | null;
  archived: boolean;
  position: number;
  created_at: string;
  // Emit a real task when this goes past its target, so the nudge lands in the
  // task list rather than only on the gauge. Off by default: some things are
  // worth watching without generating work. Requires a target_days to mean
  // anything, since without one nothing is ever "past" due.
  auto_task: boolean;
  // Template for the task auto_task emits. `{name}` interpolates the tracker's
  // name, so a rename carries through. Null means the bare name.
  task_title: string | null;
  // Derived server-side from tracker_events, so the client never has to fetch
  // the whole log just to draw a row.
  last_at: string | null; // ISO of the most recent occurrence, null if never
  event_count: number;
}

export interface TrackerEvent {
  id: string;
  tracker_id: string;
  occurred_at: string;
  note: string | null;
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
  time_spent_min: number; // accumulated actual minutes
  timer_started_at: string | null; // ISO instant a running timer began
  snoozed_until: string | null; // YYYY-MM-DD; hidden from views until this day
  blocked_until: string | null; // YYYY-MM-DD; task is blocked until this date
  // Waiting on an EXTERNAL event ("Revolut card arrives"), optionally expected
  // by a date. Not a block: the task stays visible with a chip, and once the
  // expected date passes the chip flips into a chase nudge.
  waiting_on: string | null;
  waiting_expected: string | null; // YYYY-MM-DD
  // Recurrence end conditions: last day an occurrence may land on, and/or how
  // many occurrences REMAIN (decremented per completion-roll; reaching 0
  // completes the task and clears the recurrence). See shared/recurrence.ts.
  recurrence_until: string | null;
  recurrence_count: number | null;
  // Vault linkage (two-way Obsidian sync, v1). source_text is both the match
  // key and the change detector; vault_dirty means Checkbox changed done-state
  // or due date since the vault last agreed. See shared/vault.ts.
  source_path: string | null;
  source_line: number | null;
  source_text: string | null;
  vault_dirty: number;
  // 1 = keep this task off Google Calendar without touching its dates (set by
  // hiding its chip in the calendar's all-day box). Reversible; see sync.ts.
  gcal_hidden: number;
  optional: boolean; // a nice-to-have rather than a commitment
  // "Whenever I have the chance": a thing I mean to do that will never carry a
  // date. Distinct from optional (which says I might not do it at all) and from
  // priority 4 (which ranks a commitment last). See migration 0036.
  whenever: boolean;
  planned_date: string | null; // YYYY-MM-DD; "I intend to work on this today" (not a deadline)
  scheduled_start: string | null;
  scheduled_end: string | null;
  board_column: string | null;
  section_id: string | null;
  parent_task_id: string | null;
  recurring_rule_id: string | null;
  recurrence: string | null; // compact spec, see shared/recurrence.ts
  recurrence_mode: "fixed" | "after_completion";
  // Checkpoints: surface this task in Today every `checkpoint_days` to check it
  // is on track, without touching its due date. `checkpoint_next` is the next
  // pulse date (YYYY-MM-DD) or null. See shared/checkpoint.ts.
  checkpoint_days: number | null;
  checkpoint_next: string | null;
  position: number;
  status: TaskStatus;
  completed_at: string | null;
  // If this task came from an email, the handle back to the Gmail thread.
  gmail_thread_id: string | null;
  gmail_message_id: string | null;
  gmail_permalink: string | null;
  created_at: string;
  updated_at: string;
  // joined
  labels?: Label[];
  subtasks?: Subtask[];
  depends_on?: TaskRef[]; // blockers (this task waits on these)
  blocks?: TaskRef[]; // tasks waiting on this one
  // Related tasks: symmetric, non-blocking, no bearing on order or readiness.
  // Both sides of a link carry the other, so this list is the whole answer.
  related?: TaskRef[];
}

// Lightweight task reference for dependency lists.
export interface TaskRef {
  id: string;
  title: string;
  status: TaskStatus;
  // Carried on BLOCKER refs so a blocked task can say when its blocker is owed
  // without making you open the blocker to find out. Optional because most refs
  // (related links, review lists) neither need nor set it.
  due_date?: string | null;
}

// How a saved filter talks about a DATE column. One vocabulary for both dates,
// so "due this week" and "planned this week" cannot drift apart.
//
// `overdue` means "before today" and reads differently per column, which is why
// the UI labels it per field: a due date in the past is late, a PLANNED date in
// the past is a plan you did not get to (Today carries it forward rather than
// treating it as a failure).
export type DateFilter = "any" | "overdue" | "today" | "week" | "none";

// A yes/no property of a task, plus "do not care". Three states rather than a
// boolean, because "not set" and "explicitly no" are different questions:
// `whenever: "no"` means "hide the someday pile", `undefined` means "I have not
// thought about it".
export type TriState = "any" | "yes" | "no";

// A saved filter's query. Every field optional and ANDed together server-side.
export interface FilterQuery {
  text?: string;
  priority_max?: Priority;
  label?: string;
  area_id?: string;
  project_id?: string;
  due?: DateFilter;
  // The second date (migration 0010): the day I mean to work on it. It became
  // a field you can actually SET in chat #59, which is what made its absence
  // here worth fixing.
  planned?: DateFilter;
  status?: "open" | "done" | "any";
  // The "what kind of task is this" axes. None of these had a filter at all,
  // so a flag you could set was a flag you could not then find by.
  whenever?: TriState;
  optional?: TriState;
  recurring?: TriState;
  // Blocked as the rest of the app defines it (client/lib/blocked): an open
  // task blocker OR a blocked-until date still in the future.
  blocked?: TriState;
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
  color?: string | null; // source calendar's colour (external events)
}

export interface CalendarStatus {
  connected: boolean;
  google_email: string | null;
  primary_calendar_id: string | null;
  // Set while the last Google call failed: the row still exists but nothing syncs.
  // error_kind: "auth" (reconnect), "api_disabled" (enable the Calendar API on the
  // Google Cloud project), or "other".
  sync_broken?: boolean;
  error_kind?: "auth" | "api_disabled" | "other" | null;
  activation_url?: string | null;
  last_error?: string | null;
  last_error_at?: string | null;
}

export interface CalendarFeed {
  calendar_id: string;
  summary: string | null;
  color: string | null;
  primary: boolean;
  enabled: boolean;
}

export interface GmailStatus {
  connected: boolean;
  google_email: string | null;
  sync_broken: boolean;
  error_kind: "auth" | "other" | null;
  last_error: string | null;
  last_error_at: string | null;
  last_sync_at: string | null;
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
  // "board" is Today-only (To do/Doing/Done); "recurring" is area-only (routines
  // parked out of the list until due, see client/lib/recurring).
  mode?: "grid" | "list" | "board" | "recurring" | "flow";
  sort?: string;
  group?: string;
  filter?: string; // "all" | "p1".."p4" | "overdue" | "planned"
  // Which pane the right rail shows. The calendar and the pins used to STACK, so
  // turning the calendar on pushed every pin ~1200px below the fold; they now
  // share one slot. Only meaningful where both can appear (Today).
  railTab?: "calendar" | "pins";
  // The day timeline drawn full height rather than the short window around now.
  // Compact is the default, so this only ever records an expansion.
  timelineFull?: boolean;
  // The Flow page shows one project at a time; this remembers which.
  flowProject?: string;
  // Width of the right rail in px, set by dragging the divider. Absent means the
  // default. Clamped on read as well as on write, so a silly stored value (an old
  // build, a hand-edited pref) cannot leave the board with no room.
  railWidth?: number;
}

// Per-user view preferences (stored as JSON on the users row).
// One widget on the Home dashboard. `widget` is a key ("today", "cadences") or
// a pinned thing ("view:backlog", "project:<id>", "area:<id>"). x/y/w/h are
// free-grid coordinates on the 12-column canvas (drag + resize); items saved
// before the free grid carry only `size`, which the client migrates on read.
export interface DashboardItem {
  widget: string;
  size?: "S" | "M" | "L"; // legacy width hint, superseded by w/h
  config?: Record<string, unknown>;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export interface UserPrefs {
  hiddenViews: string[]; // view keys the user has hidden from the sidebar
  viewOrder: string[]; // optional custom ordering of view keys
  viewDefaults?: Record<string, ViewDefault>; // per-view grid/sort/group memory
  // The Home dashboard's composition, in render order. Undefined = the default
  // starter layout (the client owns that default, not the server).
  dashboard?: DashboardItem[];
  // Cadence section ORDER, and any section created before it has members.
  // Membership itself lives on trackers.section; see shared/cadenceSections.
  cadenceSections?: string[];
  // Catch-all area for backlog tasks triage cannot confidently place.
  triageFallbackAreaId?: string | null;
  // Dim tasks due more than a month out so the far future doesn't pull the eye.
  // Undefined is treated as on. Toggled in Settings › Appearance.
  dimDistantTasks?: boolean;
  // All-day Google entries you have chosen not to see on the Calendar page.
  // Keyed by TITLE, not event id: these are usually standing reminders that
  // recur, and every instance gets its own id, so hiding by id would only hide
  // today's. Hiding by title keeps it hidden every day.
  hiddenAllDayTitles?: string[];
  // What Checkbox pushes to Google Calendar. Both default on (undefined ⇒ on).
  // timeBlocks = time-blocked tasks as timed events; dueDates = due-dated tasks
  // as all-day events. Toggled in Settings › Google Calendar.
  gcalSyncTimeBlocks?: boolean;
  gcalSyncDueDates?: boolean;
  // Show the read-only day timeline beside Today. Off by default: Today is a
  // list first, and the Calendar page is still where you schedule.
  todayCalendar?: boolean;
  // Show a compact cadence strip under that timeline. Off by default; the
  // Cadences page is the full board. Only rendered inside the calendar pane.
  todayCadences?: boolean;
}

// ── Attachments ────────────────────────────────────────────────────────────
export interface Attachment {
  id: string;
  task_id: string;
  kind: "file" | "link";
  url: string; // R2 key (file) or external URL (link)
  filename: string | null;
  created_at: string;
}

// ── Templates ──────────────────────────────────────────────────────────────
export interface TemplateItem {
  id: string;
  template_id: string;
  title: string;
  notes: string | null;
  priority: Priority;
  offset_days: number | null; // due = anchor + offset_days; null = no due date
  position: number;
}

export interface Template {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  created_at: string;
  items?: TemplateItem[];
}

// ── Plan my day ────────────────────────────────────────────────────────────
export interface PlanBlock {
  task_id: string;
  title: string;
  priority: Priority;
  start: string; // ISO
  end: string; // ISO
  estimate_min: number;
}

export interface PlanProposal {
  date: string;
  blocks: PlanBlock[];
  unscheduled: TaskRef[]; // couldn't find a slot
  meetings: { title: string | null; start: string; end: string }[];
}

// ── Note→task extraction (#31) ─────────────────────────────────────────────
export interface NoteCandidateRow {
  id: string;
  title: string;
  source_path: string | null;
  source_line: number | null;
  kind: "checkbox" | "todo" | "commitment";
  context: string | null;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
}

// ── Pins: non-task lists + standing reminders ───────────────────────────────
export interface PinItem {
  id: string;
  text: string;
  done: boolean;
  // Set when this line IS a task rather than a note to self. The task row stays
  // authoritative: `text` is only a fallback label and `done` is ignored, since
  // the live title and status are read from the task. Ticking the line completes
  // the task itself. An unset task_id is a plain hand-typed line.
  task_id?: string;
}
export interface Pin {
  id: string;
  // "tracker" shows the cadence gauges that most need attention (see
  // components/Cadences). It carries no content of its own: the trackers are
  // read live and ordered by urgency, so the card never goes stale and there is
  // nothing to keep in sync. An area-scoped tracker pin narrows to that area.
  kind: "note" | "list" | "tracker";
  title: string | null;
  body: string | null; // note text
  items: PinItem[]; // list lines
  pinned_today: number; // legacy; use `placement`
  placement: "unpinned" | "top" | "side";
  // Which page the pin lives on: 'today' | 'view:<name>' | 'area:<id>'.
  // `placement` then says where on that page. See lib/pinScope.ts.
  scope: string;
  color: string | null; // colour token (see lib/colors)
  // Size in the views: `span` = columns of the 4-wide pin grid (1-4);
  // `height` = fixed body height in px, or null to grow with the content.
  span: number;
  height: number | null;
  position: number;
  created_at: string;
  updated_at: string;
}

// ── Gmail coverage (Phase A) ────────────────────────────────────────────────
export interface MailCandidateRow {
  id: string;
  source: string; // planner | gmail_sync | forward | user
  thread_id: string;
  message_id: string;
  permalink: string | null;
  from_addr: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: string | null;
  verdict: "pending" | "filed" | "skipped";
  reason: string | null;
  task_id: string | null;
  user_locked: number; // 0 | 1
  created_at: string;
  updated_at: string;
  // server-computed badge
  coverage: "filed" | "skipped" | "pending" | "needs_attention";
}

// ── Ambient day plan (#30) ─────────────────────────────────────────────────
export interface DayPlanBlock {
  task_id: string;
  title: string;
  priority: Priority;
  start: string; // ISO instant
  end: string; // ISO instant
}

export interface DayPlan {
  id: string;
  date: string; // YYYY-MM-DD
  status: "proposed" | "accepted" | "dismissed";
  blocks: DayPlanBlock[];
  created_at: string;
}

// ── Weekly review ──────────────────────────────────────────────────────────
export interface WeeklyReview {
  period: { from: string; to: string };
  stats: { completed: number; slipped: number; upcoming: number; created: number };
  completed_tasks: TaskRef[];
  slipped_tasks: (TaskRef & { due_date: string | null })[];
  upcoming_tasks: (TaskRef & { due_date: string | null })[];
  by_area: { area: string; completed: number }[];
}

// ── Progress / streaks ─────────────────────────────────────────────────────
export interface Stats {
  done_today: number;
  done_this_week: number;
  streak_days: number; // consecutive days (ending today or yesterday) with a completion
  best_streak: number;
  heatmap: { date: string; count: number }[]; // last ~84 days, oldest first
}

// Payload from the NLP capture bar.
export interface CaptureParse {
  title: string;
  due_date: string | null;
  due_time: string | null;
  // The raw text chrono matched for the date (e.g. "tomorrow 3pm"), so a capture
  // UI can offer to dismiss a wrong guess and put the words back in the title.
  dateText: string | null;
  // The title with the date left in place: what to fall back to if the user
  // dismisses the detected date.
  titleWithDate: string;
  priority: Priority | null;
  labelNames: string[];
  projectName: string | null;
  recurrence: string | null; // compact spec, see shared/recurrence.ts
}
