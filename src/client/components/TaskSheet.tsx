import { lazy, Suspense, useEffect, useState } from "react";
import { format, parseISO, addDays } from "date-fns";
import type { Task, Subtask, Priority } from "../../shared/types";
import { api } from "../lib/api";
import {
  PRIORITY_LABEL,
  useAreas,
  useProjects,
  useDeleteTask,
  useTaskInvalidate,
  useTasksByIds,
  useUpdateTask,
} from "../lib/queries";
import { RECURRENCE_PRESETS, recurrenceLabel } from "../../shared/recurrence";
import { Markdown } from "../lib/markdown";
import { parseDatePhrase } from "../lib/nlp";
import { PRIORITY_VAR, shouldPill } from "../lib/colors";
import { cn, todayStr } from "@/lib/utils";
import { inToday, leaveTodayBody, undoLeaveTodayBody } from "../lib/today";
import { useToast } from "../lib/toast";
import { Button } from "./ui/button";
import { PriorityPill } from "./ui";
import { Sheet, SheetContent } from "./ui/sheet";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import {
  CalendarIcon,
  AddIcon,
  RepeatIcon,
  TrashIcon,
  SnoozeIcon,
  TodayIcon,
  ChevronRightIcon,
  MailIcon,
  ExternalLinkIcon,
  PlanIcon,
} from "../lib/icons";
import { TimeTracker } from "./TimeTracker";
import { DependencyEditor } from "./DependencyEditor";
import { AttachmentList } from "./AttachmentList";
import { useSnoozeTask } from "../lib/queries";

// Subtask priority cycles none → P1 → P2 → P3 → P4 → none on tap.
const PRI_CYCLE: (Priority | null)[] = [null, 1, 2, 3, 4];
function nextPriority(p: Priority | null): Priority | null {
  return PRI_CYCLE[(PRI_CYCLE.indexOf(p ?? null) + 1) % PRI_CYCLE.length];
}

// Lazy: react-day-picker only loads when a date picker is actually opened.
const Calendar = lazy(() =>
  import("./ui/calendar").then((m) => ({ default: m.Calendar }))
);

function DueDatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseISO(value) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-surface px-3 text-left text-sm text-foreground transition-colors hover:border-primary/60"
        >
          <CalendarIcon className="h-4 w-4 text-muted" />
          {value ? (
            format(parseISO(value), "d MMM yyyy")
          ) : (
            <span className="text-subtle">Pick a date</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        {/* Quick presets: the common reschedules without opening the grid. */}
        <div className="mb-2 flex flex-wrap gap-1">
          {[
            { label: "Today", days: 0 },
            { label: "Tomorrow", days: 1 },
            { label: "Next week", days: 7 },
          ].map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                onChange(format(addDays(new Date(), p.days), "yyyy-MM-dd"));
                setOpen(false);
              }}
              className="rounded-md bg-surface-2 px-2 py-1 text-xs text-foreground transition-colors hover:bg-surface-2/70"
            >
              {p.label}
            </button>
          ))}
        </div>
        <Suspense
          fallback={<div className="p-4 text-xs text-subtle">Loading…</div>}
        >
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(d) => {
              onChange(d ? format(d, "yyyy-MM-dd") : "");
              setOpen(false);
            }}
          />
        </Suspense>
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className="mt-1 w-full rounded px-2 py-1 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Clear date
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

// A collapsible detail section. Collapsed by default, and its header shows a
// one-line summary of what is inside, so a due date or a blocker count stays
// visible even when the section is shut. This is what keeps the sheet from being
// eleven equal-weight blocks: the work (notes, subtasks) stays open, everything
// set-once folds away but still reports itself.
function Section({
  title,
  summary,
  children,
}: {
  title: string;
  summary?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left"
      >
        <ChevronRightIcon
          className={cn(
            "h-4 w-4 shrink-0 text-muted transition-transform",
            open && "rotate-90"
          )}
        />
        <span className="text-sm font-medium text-foreground">{title}</span>
        {!open && summary && (
          <span className="ml-auto truncate pl-2 text-xs text-subtle">{summary}</span>
        )}
      </button>
      {open && <div className="mt-3 space-y-3 pl-6">{children}</div>}
    </div>
  );
}

// Task detail editor. Was the hand-rolled TaskDrawer overlay; now a shadcn Sheet
// with a real date picker. Kept always mounted so open/close animates; content
// renders only when a task is selected.
//
// Layout is frequency-zoned, not type-grouped: the work you touch every time
// (title, notes, subtasks) is always open at the top; scheduling, tracking and
// links fold into summarised sections below, because you set them once.
export function TaskSheet({
  task: opened,
  onClose,
}: {
  task: Task | null;
  onClose: () => void;
}) {
  // The caller hands us the task it had in hand when the sheet was opened: a
  // SNAPSHOT, frozen at that moment. Re-resolve it from the cache so the sheet
  // reflects its own writes. "Add to Today" wrote planned_date and invalidated
  // every list, but this component kept reading the stale snapshot, so isInToday
  // stayed false and the button never acknowledged the click. The same staleness
  // sat under every summary in here.
  //
  // By id via the ids= endpoint, because that one answers for DONE tasks too:
  // the plain list hides those, so completing a task from the sheet would
  // otherwise make it look deleted. Falls back to the snapshot while in flight.
  const live = useTasksByIds(opened ? [opened.id] : []);
  const task = live.data?.[0] ?? opened;

  const update = useUpdateTask();
  const del = useDeleteTask();
  const snooze = useSnoozeTask();
  const invalidate = useTaskInvalidate();
  const { toast } = useToast();
  const { data: areas = [] } = useAreas();
  const { data: projects = [] } = useProjects();

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [priority, setPriority] = useState<Task["priority"]>(4);
  const [estimate, setEstimate] = useState<number | "">("");
  const [recurrence, setRecurrence] = useState("");
  const [recurrenceMode, setRecurrenceMode] =
    useState<Task["recurrence_mode"]>("fixed");
  const [newSub, setNewSub] = useState("");
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [nlpDate, setNlpDate] = useState("");
  const [optional, setOptional] = useState(false);

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setNotes(task.notes ?? "");
    setEditingNotes(false);
    setDueDate(task.due_date ?? "");
    setDueTime(task.due_time ?? "");
    setPriority(task.priority);
    setEstimate(task.time_estimate_min ?? "");
    setRecurrence(task.recurrence ?? "");
    setRecurrenceMode(task.recurrence_mode ?? "fixed");
    setSubtasks(task.subtasks ?? []);
    setNlpDate("");
    setOptional(!!task.optional);
    // Keyed on the task's ID, not the task object: `task` is now a live cache
    // read, so it gets a new identity on every refetch, and depending on the
    // object would reset these fields (blowing away half-typed text) each time
    // any write invalidated the list. A different id is a genuinely different
    // task and does want a reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  // Inline NLP date: parse a phrase like "next tue 3pm" and set due date/time.
  function applyNlpDate() {
    const phrase = nlpDate.trim();
    if (!phrase) return;
    const parsed = parseDatePhrase(phrase);
    if (parsed.due_date) {
      setDueDate(parsed.due_date);
      const body: Record<string, unknown> = { due_date: parsed.due_date };
      if (parsed.due_time) {
        setDueTime(parsed.due_time);
        body.due_time = parsed.due_time;
      }
      save(body);
      setNlpDate("");
    }
  }

  function save(body: Record<string, unknown>) {
    if (!task) return;
    update.mutate({ id: task.id, body });
  }

  async function addSub() {
    if (!task || !newSub.trim()) return;
    // Use the server-assigned id so a follow-up edit (due date / priority) on the
    // fresh subtask targets the real row instead of a throwaway local id.
    const created = await api.addSubtask(task.id, newSub.trim());
    setSubtasks((s) => [
      ...s,
      {
        id: created.id,
        task_id: task.id,
        title: newSub.trim(),
        done: false,
        position: s.length,
        due_date: null,
        priority: null,
      },
    ]);
    setNewSub("");
    invalidate();
  }

  async function toggleSub(id: string, done: boolean) {
    if (!task) return;
    await api.updateSubtask(task.id, id, { done });
    setSubtasks((s) => s.map((x) => (x.id === id ? { ...x, done } : x)));
    invalidate();
  }

  // Edit a subtask's due date or priority. Optimistic: patch local state, then
  // persist. null clears the field.
  async function editSub(id: string, patch: Partial<Subtask>) {
    if (!task) return;
    setSubtasks((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    await api.updateSubtask(task.id, id, {
      ...(patch.due_date !== undefined ? { due_date: patch.due_date } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    });
    invalidate();
  }

  async function deleteSub(id: string) {
    if (!task) return;
    setSubtasks((s) => s.filter((x) => x.id !== id));
    await api.deleteSubtask(task.id, id);
    invalidate();
  }

  const subDone = subtasks.filter((s) => s.done).length;
  const plannedToday = task?.planned_date === todayStr();
  // "In Today" for any reason (planned, due today/overdue, blocked today), so the
  // toggle can actually remove it. Add sets a plan; Remove clears every trigger.
  const isInToday = task ? inToday(task, todayStr()) : false;

  // Where the task lives. A project carries its area; an area clears any project;
  // "none" drops both, sending the task to the Backlog.
  const sectionValue = task?.project_id
    ? `proj:${task.project_id}`
    : task?.area_id
    ? `area:${task.area_id}`
    : "";
  function setSection(value: string) {
    if (!task) return;
    if (value.startsWith("proj:")) {
      const id = value.slice(5);
      const p = projects.find((x) => x.id === id);
      save({ project_id: id, area_id: p?.area_id ?? null });
    } else if (value.startsWith("area:")) {
      save({ area_id: value.slice(5), project_id: null });
    } else {
      save({ area_id: null, project_id: null });
    }
  }

  function onToggleToday() {
    if (!task) return;
    if (isInToday) {
      const body = leaveTodayBody(task, todayStr());
      save(body);
      const prev = undoLeaveTodayBody(task, body);
      toast("Removed from Today", () => save(prev));
    } else {
      save({ planned_date: todayStr() });
      toast("Added to Today");
    }
  }

  // Section summaries: what each collapsed section reports about itself.
  const scheduleSummary =
    [
      dueDate ? format(parseISO(dueDate), "d MMM") + (dueTime ? ` ${dueTime}` : "") : null,
      plannedToday ? "today" : null,
      recurrence ? recurrenceLabel(recurrence) : null,
      task?.scheduled_start ? "time-blocked" : null,
      task?.snoozed_until ? "snoozed" : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Not scheduled";

  // Gmail thread handles (present only for email-derived tasks).
  const gmailThread = task?.gmail_thread_id ?? null;
  const gmailUrl =
    task?.gmail_permalink ||
    (gmailThread ? `https://mail.google.com/mail/u/0/#all/${gmailThread}` : null);
  // Draft reply and Mark Awaiting are Claude-mediated in Phase A: the Worker
  // holds no Gmail credential, so a deep-link hands the job to a Claude session
  // that has the Gmail + Checkbox connectors. Zero API cost; needs those
  // connectors attached.
  const draftReplyUrl = gmailThread
    ? `https://claude.ai/new?q=${encodeURIComponent(
        `Draft a reply to my Gmail thread ${gmailThread} (for my Checkbox task "${task?.title}"). ` +
          "Use the Gmail MCP: get_thread to read it, then create_draft with a reply " +
          "that fits how I usually respond in that context. Leave it as a DRAFT in " +
          "Gmail for me to review and send. Do NOT send it."
      )}`
    : null;
  const awaitingUrl = gmailThread
    ? `https://claude.ai/new?q=${encodeURIComponent(
        `Apply my "Awaiting" label to Gmail thread ${gmailThread} (Gmail MCP label_thread). ` +
          "I'm waiting on a reply. Do not send anything."
      )}`
    : null;

  return (
    <Sheet
      open={!!task}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent side="right" className="w-[28rem] max-w-full overflow-y-auto">
        {task && (
          <div className="flex flex-col gap-4">
            {/* ── Always open: identity + the work ──────────────────────── */}
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title !== task.title && save({ title })}
              className="w-full bg-transparent pr-8 text-lg font-semibold text-foreground outline-none"
            />

            {/* Priority: quick to set, worth scanning, stays visible. */}
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4].map((p) => {
                const on = priority === p;
                return (
                  <button
                    key={p}
                    onClick={() => {
                      setPriority(p as Task["priority"]);
                      save({ priority: p });
                    }}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs transition-colors",
                      on
                        ? "border-primary bg-primary/15 text-foreground"
                        : "border-border hover:bg-surface-2"
                    )}
                    style={on ? undefined : { color: PRIORITY_VAR[p as Task["priority"]] }}
                  >
                    P{p}
                  </button>
                );
              })}
              <span className="ml-1 text-[11px] text-subtle">
                {PRIORITY_LABEL[priority]}
              </span>
            </div>

            {/* Add to Today: one of the most-used actions, so it lives up top,
                always visible, not buried in the Schedule section. Marks intent
                to work on it today without touching the deadline. */}
            {task.status !== "done" && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleToday}
                  className={cn(
                    "inline-flex w-fit items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors",
                    isInToday
                      ? "border-primary bg-primary/15 text-primary hover:bg-primary/10"
                      : "border-border text-foreground hover:border-primary/50 hover:bg-surface-2"
                  )}
                >
                  <TodayIcon className="h-4 w-4" />
                  {isInToday ? "Remove from Today" : "Add to Today"}
                </button>

                {/* Optional: a nice-to-have rather than a commitment. Dashed
                    styling here mirrors the dashed tick + chip on the row. */}
                <button
                  type="button"
                  title="Optional: a nice-to-have, not a commitment"
                  onClick={() => {
                    const v = !optional;
                    setOptional(v);
                    // D1 has no boolean type, so store 0/1.
                    save({ optional: v ? 1 : 0 });
                  }}
                  className={cn(
                    "inline-flex w-fit items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1.5 text-sm font-medium transition-colors",
                    optional
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input text-muted hover:border-primary/50 hover:bg-surface-2"
                  )}
                >
                  Optional
                </button>
              </div>
            )}

            {/* Area / project - change where the task lives without leaving the
                sheet. "No section" sends it to the Backlog. */}
            <label className="flex items-center gap-2 text-xs text-muted">
              <span className="shrink-0">In</span>
              <select
                value={sectionValue}
                onChange={(e) => setSection(e.target.value)}
                className="h-9 flex-1 rounded-md border border-input bg-surface px-2 text-sm text-foreground outline-none focus:border-primary"
              >
                <option value="">No section (Backlog)</option>
                {areas.length > 0 && (
                  <optgroup label="Areas">
                    {areas.map((a) => (
                      <option key={a.id} value={`area:${a.id}`}>
                        {a.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {projects.length > 0 && (
                  <optgroup label="Projects">
                    {projects.map((p) => (
                      <option key={p.id} value={`proj:${p.id}`}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>

            {/* Notes: rendered markdown when idle, textarea on click/focus.
                Blur commits and returns to the rendered preview. */}
            {editingNotes || !notes.trim() ? (
              <textarea
                value={notes}
                autoFocus={editingNotes}
                onFocus={() => setEditingNotes(true)}
                // Mark editing in the SAME change as the keystroke. Otherwise the
                // first character (which makes notes non-empty) would flip the
                // ternary back to the preview and yank focus - the old bug where an
                // empty note only accepted one character. React batches both, so
                // editingNotes is already true when the row re-renders.
                onChange={(e) => {
                  setNotes(e.target.value);
                  setEditingNotes(true);
                }}
                onBlur={() => {
                  setEditingNotes(false);
                  if (notes !== (task.notes ?? "")) save({ notes });
                }}
                placeholder="Notes... (markdown supported)"
                rows={3}
                className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingNotes(true)}
                className="rounded-md border border-transparent px-3 py-2 text-left text-sm text-foreground transition-colors hover:border-border"
                title="Click to edit"
              >
                <Markdown text={notes} className="space-y-0.5" />
              </button>
            )}

            {/* Subtasks: part of the work, always open. */}
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">Subtasks</span>
                {subtasks.length > 0 && (
                  <span className="text-[11px] text-subtle">
                    {subDone}/{subtasks.length}
                  </span>
                )}
              </div>
              {subtasks.length > 0 && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{
                      width: `${Math.round((subDone / subtasks.length) * 100)}%`,
                    }}
                  />
                </div>
              )}
              <div className="mt-2 space-y-1">
                {subtasks.map((s) => (
                  <div
                    key={s.id}
                    className="group flex items-center gap-2 text-sm text-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={s.done}
                      onChange={(e) => toggleSub(s.id, e.target.checked)}
                      className="h-4 w-4 shrink-0 [accent-color:var(--primary)]"
                    />
                    <span
                      className={cn("flex-1 truncate", s.done && "text-subtle line-through")}
                    >
                      {s.title}
                    </span>
                    {/* Compact per-subtask priority (tap to cycle none→P1..P4) and
                        a slim due date, on the title line instead of a bulky row. */}
                    <button
                      type="button"
                      title="Cycle priority"
                      onClick={() => editSub(s.id, { priority: nextPriority(s.priority) })}
                      className="shrink-0"
                    >
                      {shouldPill(s.priority) ? (
                        <PriorityPill priority={s.priority} />
                      ) : (
                        <span className="grid h-5 min-w-[1.25rem] place-items-center rounded border border-border px-1 text-[10px] text-subtle transition-colors hover:text-foreground">
                          P
                        </span>
                      )}
                    </button>
                    <input
                      type="date"
                      value={s.due_date ?? ""}
                      onChange={(e) => editSub(s.id, { due_date: e.target.value || null })}
                      aria-label="Subtask due date"
                      className={cn(
                        "h-6 w-[6.5rem] shrink-0 rounded border bg-surface px-1 text-[11px] outline-none focus:border-primary",
                        s.due_date
                          ? "border-input text-foreground"
                          : "border-border text-subtle"
                      )}
                    />
                    <button
                      onClick={() => deleteSub(s.id)}
                      aria-label="Delete subtask"
                      className="hidden shrink-0 text-subtle hover:text-danger group-hover:block"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-1 flex gap-2">
                <input
                  value={newSub}
                  onChange={(e) => setNewSub(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addSub()}
                  placeholder="Add subtask"
                  className="h-9 flex-1 rounded-md border border-input bg-surface px-3 text-sm text-foreground outline-none focus:border-primary"
                />
                <Button variant="secondary" size="sm" onClick={addSub}>
                  <AddIcon className="h-4 w-4" /> Add
                </Button>
              </div>
            </div>

            {/* From Gmail: thread handles, only for email-derived tasks. Open in
                Gmail is a plain link; Draft reply and Mark Awaiting hand off to a
                Claude session (the Worker holds no Gmail credential in Phase A). */}
            {gmailThread && (
              <div className="rounded-md border border-border bg-surface-2/40 p-2.5">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
                  <MailIcon className="h-3.5 w-3.5" /> From Gmail
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {gmailUrl && (
                    <a
                      href={gmailUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-xs text-foreground transition-colors hover:bg-surface-2/70"
                    >
                      <ExternalLinkIcon className="h-3.5 w-3.5" /> Open in Gmail
                    </a>
                  )}
                  {draftReplyUrl && (
                    <a
                      href={draftReplyUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="Opens a Claude chat that drafts a reply via your Gmail + Checkbox connectors. Runs on your subscription; needs those connectors attached."
                      className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-xs text-foreground transition-colors hover:bg-surface-2/70"
                    >
                      <PlanIcon className="h-3.5 w-3.5 text-primary" /> Draft reply
                    </a>
                  )}
                  {awaitingUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        // Local snooze lands immediately (no credential); the
                        // Gmail label is best-effort via Claude.
                        snooze.mutate({
                          id: task.id,
                          until: format(addDays(new Date(), 7), "yyyy-MM-dd"),
                        });
                        window.open(awaitingUrl, "_blank", "noopener");
                      }}
                      title="Snoozes the task a week and asks Claude to apply your Awaiting label in Gmail."
                      className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-xs text-foreground transition-colors hover:bg-surface-2/70"
                    >
                      <SnoozeIcon className="h-3.5 w-3.5" /> Mark Awaiting
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-[10px] text-subtle">
                  Draft reply and Mark Awaiting open Claude (needs your Gmail +
                  Checkbox connectors). Checkbox never sends mail.
                </p>
              </div>
            )}

            {/* ── Set-once, folded away but self-reporting ──────────────── */}
            <Section title="Schedule" summary={scheduleSummary}>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-muted">
                  Due date
                  <div className="mt-1">
                    <DueDatePicker
                      value={dueDate}
                      onChange={(v) => {
                        setDueDate(v);
                        save({ due_date: v || null });
                      }}
                    />
                  </div>
                </label>
                <label className="text-xs text-muted">
                  Due time
                  <input
                    type="time"
                    value={dueTime}
                    onChange={(e) => setDueTime(e.target.value)}
                    onBlur={() => save({ due_time: dueTime || null })}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground outline-none focus:border-primary"
                  />
                </label>
              </div>

              {/* Inline NLP date: type a phrase, Enter (or ↵ button) to set. */}
              <input
                value={nlpDate}
                onChange={(e) => setNlpDate(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyNlpDate()}
                onBlur={applyNlpDate}
                placeholder="Type a date… e.g. next tue 3pm, in 2 weeks"
                className="h-8 w-full rounded-md border border-dashed border-input bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-subtle focus:border-primary"
              />

              {/* Time block: set by dragging on the calendar; shown here so it is
                  visible and clearable from the task too. */}
              {task.scheduled_start && (
                <div className="flex items-center justify-between rounded-md bg-surface-2/60 px-2.5 py-1.5 text-xs">
                  <span className="flex items-center gap-1.5 text-foreground">
                    <CalendarIcon className="h-3.5 w-3.5 text-muted" />
                    {format(parseISO(task.scheduled_start), "d MMM HH:mm")}
                    {task.scheduled_end
                      ? `–${format(parseISO(task.scheduled_end), "HH:mm")}`
                      : ""}
                  </span>
                  <button
                    onClick={() =>
                      save({ scheduled_start: null, scheduled_end: null })
                    }
                    className="text-muted transition-colors hover:text-danger"
                  >
                    Clear
                  </button>
                </div>
              )}

              {/* Snooze: hide until a chosen day. */}
              <div>
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <SnoozeIcon className="h-3.5 w-3.5" /> Snooze
                  {task.snoozed_until && (
                    <span className="text-warning">until {task.snoozed_until}</span>
                  )}
                </span>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {[
                    { label: "Tomorrow", days: 1 },
                    { label: "In 3 days", days: 3 },
                    { label: "Next week", days: 7 },
                  ].map((s) => (
                    <button
                      key={s.label}
                      onClick={() =>
                        snooze.mutate({
                          id: task.id,
                          until: format(addDays(new Date(), s.days), "yyyy-MM-dd"),
                        })
                      }
                      className="rounded-md bg-surface-2 px-2 py-1 text-xs text-foreground transition-colors hover:bg-surface-2/70"
                    >
                      {s.label}
                    </button>
                  ))}
                  {task.snoozed_until && (
                    <button
                      onClick={() => snooze.mutate({ id: task.id, until: null })}
                      className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Repeat. */}
              <div>
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <RepeatIcon className="h-3.5 w-3.5" /> Repeat
                </span>
                <div className="mt-1 flex gap-2">
                  <select
                    value={recurrence}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRecurrence(v);
                      save({ recurrence: v || null });
                    }}
                    className="h-9 flex-1 rounded-md border border-input bg-surface px-2 text-sm text-foreground outline-none focus:border-primary"
                  >
                    {RECURRENCE_PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  {recurrence && (
                    <select
                      value={recurrenceMode}
                      onChange={(e) => {
                        const v = e.target.value as Task["recurrence_mode"];
                        setRecurrenceMode(v);
                        save({ recurrence_mode: v });
                      }}
                      className="h-9 rounded-md border border-input bg-surface px-2 text-sm text-foreground outline-none focus:border-primary"
                      title="When completed, advance from…"
                    >
                      <option value="fixed">from due date</option>
                      <option value="after_completion">after completion</option>
                    </select>
                  )}
                </div>
                {recurrence && (
                  <p className="mt-1 text-[11px] text-subtle">
                    Completing this task rolls it to the next occurrence, and drops it
                    out of Today, instead of finishing it.
                  </p>
                )}
              </div>
            </Section>

            {/* Tracking - a discreet inline strip, not a whole section: the
                start/stop timer with a small estimate field beside it. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3">
              <TimeTracker task={task} />
              <label className="flex items-center gap-1 text-xs text-subtle">
                <input
                  type="number"
                  value={estimate}
                  onChange={(e) =>
                    setEstimate(e.target.value === "" ? "" : Number(e.target.value))
                  }
                  onBlur={() =>
                    save({ time_estimate_min: estimate === "" ? null : Number(estimate) })
                  }
                  placeholder="–"
                  className="h-7 w-14 rounded-md border border-input bg-surface px-2 text-xs text-foreground outline-none focus:border-primary"
                />
                min est
              </label>
            </div>

            {/* Links & files - used often, so always open (not folded away). */}
            <div className="space-y-3 border-t border-border pt-3">
              <DependencyEditor task={task} />
              <AttachmentList taskId={task.id} />
            </div>

            <div className="mt-2 border-t border-border pt-4">
              <Button
                variant="ghost"
                className="text-danger hover:bg-danger/10"
                onClick={() => {
                  del.mutate(task.id);
                  onClose();
                }}
              >
                Delete task
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
