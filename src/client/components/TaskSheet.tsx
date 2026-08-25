import { lazy, Suspense, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  useAttachments,
  useCompleteTask,
} from "../lib/queries";
import { RECURRENCE_PRESETS, recurrenceLabel } from "../../shared/recurrence";
import { Markdown } from "../lib/markdown";
import { parseDatePhrase, parseCapture } from "../lib/nlp";
import { PRIORITY_VAR, shouldPill } from "../lib/colors";
import { useCompleteGuard } from "../lib/use-complete-guard";
import { taskHomePath, taskHomeLabel } from "../lib/use-focus-task";
import { cn, todayStr } from "@/lib/utils";
import {
  inTodayView,
  leaveTodayBody,
  undoLeaveTodayBody,
  hasCheckpointDue,
} from "../lib/today";
import {
  startCheckpointBody,
  advanceCheckpointBody,
} from "../../shared/checkpoint";
import { useToast } from "../lib/toast";
import { Button } from "./ui/button";
import { PriorityPill } from "./ui";
import { Sheet, SheetContent } from "./ui/sheet";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import {
  CalendarIcon,
  ClockIcon,
  AddIcon,
  RepeatIcon,
  TrashIcon,
  SnoozeIcon,
  TodayIcon,
  CheckpointIcon,
  NotesIcon,
  MailIcon,
  ExternalLinkIcon,
  PlanIcon,
  TimerIcon,
  AttachIcon,
  CheckIcon,
  NavigateIcon,
} from "../lib/icons";
import { TimeTracker } from "./TimeTracker";
import {
  BlockersEditor,
  BlockedUntilEditor,
  WaitingOnEditor,
} from "./DependencyEditor";
import { RelatedEditor } from "./RelatedEditor";
import { SectionPicker } from "./SectionPicker";
import { AttachmentList } from "./AttachmentList";
import { useSnoozeTask } from "../lib/queries";

// A subtask's title: full text always visible (wraps, never truncates) and
// editable in place. Click, type, blur to save. It was a truncated read-only
// span: long steps were unreadable and typos permanent.
function SubtaskTitle({
  value,
  done,
  onSave,
}: {
  value: string;
  done: boolean;
  onSave: (title: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <textarea
      value={text}
      rows={1}
      onChange={(e) => {
        setText(e.target.value);
        e.target.style.height = "auto";
        e.target.style.height = `${e.target.scrollHeight}px`;
      }}
      ref={(el) => {
        if (el) {
          el.style.height = "auto";
          el.style.height = `${el.scrollHeight}px`;
        }
      }}
      onBlur={() => {
        const t = text.trim();
        if (t && t !== value) onSave(t);
        else setText(value);
      }}
      className={cn(
        "flex-1 resize-none overflow-hidden bg-transparent text-sm leading-snug outline-none",
        done ? "text-subtle line-through" : "text-foreground"
      )}
    />
  );
}

// A step's due date. Set, it reads as the date; unset, it collapses to a small
// calendar mark, so a three-step task stops showing three empty dd/mm/yyyy
// fields. Clicking the mark opens the real input, which stays until it blurs.
//
// Quiet but always present, NOT hover-only like the delete button beside it:
// the phone is where this app is mostly used and there is no hover there, so a
// hover-only control would mean a step's date could not be set at all. What is
// collapsed is the empty control's SIZE, never its reachability, and never a
// value (a step's date is what carries its parent into Today).
function SubtaskDate({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing || value)
    return (
      <input
        type="date"
        value={value ?? ""}
        autoFocus={editing && !value}
        onChange={(e) => onChange(e.target.value || null)}
        onBlur={() => setEditing(false)}
        aria-label="Subtask due date"
        className={cn(
          "h-6 w-[6.5rem] shrink-0 rounded border bg-surface px-1 text-[11px] outline-none focus:border-primary",
          value ? "border-input text-foreground" : "border-border text-subtle"
        )}
      />
    );
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label="Set a due date for this subtask"
      title="Give this step a date"
      className="shrink-0 text-subtle/60 transition-colors hover:text-foreground"
    >
      <CalendarIcon className="h-3.5 w-3.5" />
    </button>
  );
}

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
  onDateTime,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  // When given, a free-text "type a date" box inside the popover parses a phrase
  // like "next tue 3pm" and reports BOTH the date and any time. This is the
  // natural-language date entry for a task, kept here rather than as a separate
  // field so the picker is one place: presets, calendar, or type it.
  onDateTime?: (date: string, time: string | null) => void;
  // Due and Planned now sit side by side, so each gets half a 28rem sheet. The
  // year is dropped when it is this one ("5 Sep" rather than "5 Sep 2026"),
  // which is what makes two dates plus a time popover fit on one line.
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const selected = value ? parseISO(value) : undefined;

  function applyPhrase() {
    const p = phrase.trim();
    if (!p) return;
    const parsed = parseDatePhrase(p);
    if (parsed.due_date) {
      (onDateTime ?? ((d) => onChange(d)))(parsed.due_date, parsed.due_time);
      setPhrase("");
      setOpen(false);
    }
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-surface px-3 text-left text-sm text-foreground transition-colors hover:border-primary/60"
        >
          <CalendarIcon className="h-4 w-4 text-muted" />
          {value ? (
            <span className="truncate">
              {format(
                parseISO(value),
                parseISO(value).getFullYear() === new Date().getFullYear()
                  ? "d MMM"
                  : "d MMM yy"
              )}
            </span>
          ) : (
            <span className="truncate text-subtle">{placeholder ?? "Pick a date"}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        {/* Type a date in words: "next tue 3pm", "in 2 weeks". Only when the
            caller wired onDateTime (the task sheet does). */}
        {onDateTime && (
          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyPhrase()}
            onBlur={applyPhrase}
            placeholder="Type a date… e.g. next tue 3pm"
            className="mb-2 h-8 w-full rounded-md border border-dashed border-input bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-subtle focus:border-primary"
          />
        )}
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

// The due TIME, as a small popover that only exists once there is a due date.
// Time is the rarer half of a deadline, so it should not sit as a permanent
// empty field: a bare clock icon that becomes "HH:MM" when set, opening a
// native time input on click. Clearable from inside. Unset shows the icon
// alone (no "time" word): the tooltip explains it, and the label was noise
// beside the date control.
function DueTimePopover({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={value ? "Due time" : "Add a due time"}
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-1 rounded-md border px-2 text-sm transition-colors",
            value
              ? "border-input text-foreground hover:border-primary/60"
              : "border-dashed border-input text-subtle hover:border-primary/60 hover:text-foreground"
          )}
        >
          <ClockIcon className="h-3.5 w-3.5" />
          {value || null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <input
          type="time"
          value={value}
          autoFocus
          onChange={(e) => onChange(e.target.value)}
          className="h-9 rounded-md border border-input bg-surface px-3 text-sm text-foreground outline-none focus:border-primary"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className="mt-1 w-full rounded px-2 py-1 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Clear time
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

// Checkpoints: pulse a long-horizon task into Today every N days to check it is
// on track, without touching its due date. An interval picker (presets + custom)
// and, when a pulse is pending, its next date + a "mark on track" that advances.
const CHECKPOINT_PRESETS: { label: string; days: number }[] = [
  { label: "Weekly", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "Monthly", days: 30 },
];

function CheckpointControl({
  task,
  save,
  today,
}: {
  task: Task;
  save: (body: Record<string, unknown>) => void;
  today: string;
}) {
  const days = task.checkpoint_days ?? null;
  const next = task.checkpoint_next ?? null;
  const dueDue = hasCheckpointDue(task, today);
  // Checkpoints only run BEFORE the due date, so a task already due (or overdue)
  // has no room for them: it is surfacing in Today every day anyway. Disable the
  // controls and say why, rather than accepting a click that silently clears.
  const noHeadroom = task.due_date != null && task.due_date <= today;

  const set = (n: number) =>
    save(startCheckpointBody(today, n, task.due_date));
  const clear = () =>
    save({ checkpoint_days: null, checkpoint_next: null });
  const onTrack = () =>
    save(advanceCheckpointBody(today, days, next, task.due_date));

  return (
    <div>
      <span
        className="flex w-fit cursor-help items-center gap-1.5 text-xs text-muted underline decoration-dotted decoration-from-font underline-offset-2"
        title={
          "Checkpoints: nudge you to check progress on THIS task every N days on its way to its due date. Marking it on track moves it to the next pulse; the due date never changes.\n\n" +
          "Not a repeat (which finishes and starts again), and not a cadence (sidebar: things with no deadline that reset whenever you do them)."
        }
      >
        <CheckpointIcon className="h-3.5 w-3.5" /> Checkpoints
        {days && (
          <span className="text-subtle">
            every {days}d
            {next ? ` · next ${next}` : " · done"}
          </span>
        )}
      </span>
      {noHeadroom && !days ? (
        <p className="mt-1 text-[11px] text-subtle">
          Checkpoints run before the due date. This task is already due, so
          there is nothing to pace.
        </p>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {CHECKPOINT_PRESETS.map((p) => (
            <button
              key={p.days}
              type="button"
              onClick={() => set(p.days)}
              className={cn(
                "rounded-md px-2 py-1 text-xs transition-colors",
                days === p.days
                  ? "bg-primary/15 text-primary"
                  : "bg-surface-2 text-foreground hover:bg-surface-2/70"
              )}
            >
              {p.label}
            </button>
          ))}
          <input
            type="number"
            min={1}
            placeholder="N days"
            // Uncontrolled: committing on Enter/blur avoids fighting the live
            // task read while you type a number.
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const n = Number((e.target as HTMLInputElement).value);
              if (n > 0) set(n);
            }}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (n > 0 && n !== days) set(n);
            }}
            className="h-7 w-16 rounded-md border border-input bg-surface px-2 text-xs text-foreground outline-none focus:border-primary"
          />
          {days && (
            <button
              type="button"
              onClick={clear}
              className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              Off
            </button>
          )}
        </div>
      )}
      {/* When a pulse is due, the on-track action is right here too (it is also
          on the row in Today). */}
      {dueDue && (
        <button
          type="button"
          onClick={onTrack}
          className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-primary/40 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
        >
          <CheckpointIcon className="h-3.5 w-3.5" /> On track
        </button>
      )}
      {days && task.due_date == null && (
        <p className="mt-1 text-[11px] text-subtle">
          Runs indefinitely with no due date. Add one to have checkpoints stop
          when it arrives.
        </p>
      )}
    </div>
  );
}

// A collapsible detail section. Collapsed by default, and its header shows a
// one-line summary of what is inside, so a due date or a blocker count stays
// visible even when the section is shut. This is what keeps the sheet from being
// eleven equal-weight blocks: the work (notes, subtasks) stays open, everything
// set-once folds away but still reports itself.
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
  const complete = useCompleteTask();
  // Same question every other completion path asks: finishing a task with open
  // steps is nearly always a slip.
  const { guard, dialog: guardDialog } = useCompleteGuard();
  const navigate = useNavigate();
  const del = useDeleteTask();
  const snooze = useSnoozeTask();
  const invalidate = useTaskInvalidate();
  const { toast } = useToast();
  const { data: areas = [] } = useAreas();
  const { data: projects = [] } = useProjects();
  // Read here (not only inside AttachmentList) so the Task tab can say "2 files"
  // when there are any: a value on the More tab must never be invisible.
  const { data: attachments = [] } = useAttachments(task?.id ?? null);

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  // The second date. due_date is when the task is OWED; planned_date is the day
  // I mean to work on it, and it moves around freely. The column has existed
  // since migration 0010 (it is what "Add to Today" writes), but the only way to
  // set it was that button, so the one date that shifts most could only ever be
  // set to today. Now it is a picker beside the deadline.
  const [plannedDate, setPlannedDate] = useState("");
  const [priority, setPriority] = useState<Task["priority"]>(4);
  const [estimate, setEstimate] = useState<number | "">("");
  const [recurrence, setRecurrence] = useState("");
  const [recurrenceMode, setRecurrenceMode] =
    useState<Task["recurrence_mode"]>("fixed");
  // End conditions: "" = never, "count" = after N times, "until" = on a date.
  const [recEnd, setRecEnd] = useState<"" | "count" | "until">("");
  const [recCount, setRecCount] = useState<number | "">("");
  const [recUntil, setRecUntil] = useState("");
  const [newSub, setNewSub] = useState("");
  // Revealed by the "+ Step" chip on a task that has none yet.
  const [addingSub, setAddingSub] = useState(false);
  // "Keep as text": disables capture-parsing for subtasks typed in this sheet.
  const [rawSub, setRawSub] = useState(false);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [optional, setOptional] = useState(false);
  // Which half of the sheet is showing. Always opens on Task: More is where you
  // go deliberately, and a sheet that remembered the other tab would greet the
  // next task with its repeat settings.
  const [tab, setTab] = useState<"task" | "more">("task");

  useEffect(() => {
    if (!task) return;
    setTab("task");
    setTitle(task.title);
    setNotes(task.notes ?? "");
    setEditingNotes(false);
    setDueDate(task.due_date ?? "");
    setDueTime(task.due_time ?? "");
    setPlannedDate(task.planned_date ?? "");
    setPriority(task.priority);
    setEstimate(task.time_estimate_min ?? "");
    setRecurrence(task.recurrence ?? "");
    setRecurrenceMode(task.recurrence_mode ?? "fixed");
    setRecEnd(task.recurrence_count != null ? "count" : task.recurrence_until ? "until" : "");
    setRecCount(task.recurrence_count ?? "");
    setRecUntil(task.recurrence_until ?? "");
    setSubtasks(task.subtasks ?? []);
    setAddingSub(false);
    setOptional(!!task.optional);
    // Keyed on the task's ID, not the task object: `task` is now a live cache
    // read, so it gets a new identity on every refetch, and depending on the
    // object would reset these fields (blowing away half-typed text) each time
    // any write invalidated the list. A different id is a genuinely different
    // task and does want a reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  function save(body: Record<string, unknown>) {
    if (!task) return;
    update.mutate({ id: task.id, body });
  }

  // What the capture parser WOULD do to the typed subtask, previewed as chips
  // under the input. It used to fire invisibly: dates vanished from titles and
  // subtasks got scheduled with no pills shown and no way to say no.
  const subParse = parseCapture(newSub);
  const subParsed =
    newSub.trim() !== "" && (subParse.due_date != null || subParse.priority != null);

  async function addSub() {
    if (!task || !newSub.trim()) return;
    // Same quick-capture parsing the main add-task bar uses, so a subtask can be
    // dated in the flow of typing it: "post the form fri p1" files the date and
    // priority and keeps just "post the form" as the title. This is the whole
    // reason subtask due dates were near-unused: they were reachable only by
    // adding a bare subtask and then editing it. `#category`/`@label` do not
    // apply to a subtask, so knownCategories is empty and any name typed stays in
    // the title. Falls back to the raw text when nothing is parsed out.
    const p = rawSub ? null : parseCapture(newSub);
    const title = (p?.title ?? newSub).trim() || newSub.trim();
    const due_date = p?.due_date ?? null;
    const priority = p?.priority ?? null;
    // Use the server-assigned id so a follow-up edit (due date / priority) on the
    // fresh subtask targets the real row instead of a throwaway local id.
    const created = await api.addSubtask(task.id, title, { due_date, priority });
    setSubtasks((s) => [
      ...s,
      {
        id: created.id,
        task_id: task.id,
        title,
        done: false,
        position: s.length,
        due_date,
        priority,
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
      ...(patch.title !== undefined ? { title: patch.title } : {}),
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

  // The area whose colour paints the breadcrumb dot. Resolved through the
  // project when the task carries no area of its own, matching the rows.
  const crumbArea = areas.find(
    (a) =>
      a.id ===
      (task?.area_id ?? projects.find((p) => p.id === task?.project_id)?.area_id ?? null)
  );

  // Rare fields that are SET on this task, and so get a chip on the Task tab.
  // The list is deliberately the same set that lives on More: a field is either
  // rare-and-unset (More only) or rare-and-set (More, plus a chip that says so).
  const promoted: { label: string; Icon: typeof RepeatIcon }[] = task
    ? [
        task.recurrence && {
          label: recurrenceLabel(task.recurrence),
          Icon: RepeatIcon,
        },
        task.snoozed_until && {
          label: `snoozed to ${task.snoozed_until}`,
          Icon: SnoozeIcon,
        },
        task.checkpoint_days && {
          label: `check-in every ${task.checkpoint_days}d`,
          Icon: CheckpointIcon,
        },
        task.scheduled_start && {
          label: format(parseISO(task.scheduled_start), "d MMM HH:mm"),
          Icon: CalendarIcon,
        },
        task.time_estimate_min && {
          label: `${task.time_estimate_min}m estimate`,
          Icon: TimerIcon,
        },
        task.time_spent_min > 0 && {
          label: `${task.time_spent_min}m tracked`,
          Icon: TimerIcon,
        },
        attachments.length > 0 && {
          label: `${attachments.length} file${attachments.length === 1 ? "" : "s"}`,
          Icon: AttachIcon,
        },
      ].filter(Boolean as unknown as (v: unknown) => v is { label: string; Icon: typeof RepeatIcon })
    : [];

  const subDone = subtasks.filter((s) => s.done).length;
  // "In Today" for any reason the VIEW holds it (planned, due, time-blocked, a
  // due subtask, a due checkpoint), so the toggle can actually remove it. Add
  // sets a plan; Remove clears what it safely can and snoozes past the rest.
  const isInToday = task ? inTodayView(task, todayStr()) : false;

  // Where the task lives. A project carries its area; an area clears any project;
  // "" drops both, sending the task to the Backlog. SectionPicker reads the
  // current value off the task itself and hands back one of those three shapes.
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

  // Finish (or un-finish) the task from the panel itself. Every other surface
  // in the app has a complete circle; the sheet, which is where you land when
  // you actually want to read a task before deciding, did not, so the only way
  // to tick something off from here was to close the sheet and find the row
  // again. Routed through the guard like every other completion path.
  function onComplete() {
    if (!task) return;
    const wasDone = task.status === "done";
    guard(task, async () => {
      await complete.mutateAsync({ id: task.id, done: !wasDone });
      if (wasDone) return;
      toast(
        task.recurrence ? "Done for today · repeats tomorrow morning" : "Completed",
        () => complete.mutate({ id: task.id, done: false })
      );
    });
  }

  // Open the task where it actually lives: its project page, its area page, or
  // the list it falls into. Her ask, and the gap it closes is real - the sheet
  // can tell you a task is in "Revisia", but seeing it in context (what is
  // beside it, which board column it sits in, what the project looks like) meant
  // navigating there by hand and then finding the task again. The destination
  // page scrolls to it and flashes it (lib/use-focus-task).
  function onNavigate() {
    if (!task) return;
    navigate(taskHomePath(task, todayStr()));
    onClose();
  }

  function onToggleToday() {
    if (!task) return;
    if (isInToday) {
      const body = leaveTodayBody(task, todayStr());
      save(body);
      // The planned picker sits right beside this button now, so it has to move
      // when the button clears the plan. Local state only resets on a new task.
      if ("planned_date" in body) setPlannedDate("");
      const prev = undoLeaveTodayBody(task, body);
      // Mirrors useToggleToday: name the deferral so tomorrow's return
      // (subtask or checkpoint still due) is announced up front.
      toast(
        body.snoozed_until != null
          ? "Removed from Today until tomorrow"
          : "Removed from Today",
        () => save(prev)
      );
    } else {
      save({ planned_date: todayStr() });
      setPlannedDate(todayStr());
      toast("Added to Today");
    }
  }

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
            {/* ── Where it lives: a breadcrumb, not a labelled control ────
                86% of tasks carry an area and 64% a project, so this is a fact
                about nearly every task and it used to spend a full-height
                labelled select saying so. It is now the line above the title,
                and the select itself is invisible until you click it. */}
            <div className="-mb-1 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <SectionPicker
                  areas={areas}
                  projects={projects}
                  areaId={task.area_id}
                  projectId={task.project_id}
                  onPick={setSection}
                />
              </div>
              {/* Open it where it lives, and finish it from here. Both are
                  things every other surface could already do and the panel
                  could not. They sit on the breadcrumb line rather than beside
                  the title, so the title stays a single editable field. */}
              <button
                type="button"
                onClick={onNavigate}
                title={`Open in ${taskHomeLabel(
                  task,
                  projects.find((p) => p.id === task.project_id)?.name,
                  crumbArea?.name
                )}`}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border text-muted transition-colors hover:border-primary/60 hover:text-foreground"
              >
                <NavigateIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onComplete}
                title={task.status === "done" ? "Mark not done" : "Complete this task"}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors",
                  task.status === "done"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted hover:border-primary/60 hover:text-foreground"
                )}
              >
                <CheckIcon className="h-3.5 w-3.5" />
                {task.status === "done" ? "Done" : "Complete"}
              </button>
            </div>

            {/* ── Always open: identity + the work ──────────────────────── */}
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title !== task.title && save({ title })}
              className="w-full bg-transparent pr-8 text-lg font-semibold text-foreground outline-none"
            />

            {/* Task / More. The split is by how often a field is actually set
                across her tasks, not by category: what she sets on more than
                one task in ten lives on Task, the rest on More. A rare field
                that IS set on THIS task is not hidden by that rule; it appears
                as a chip below, so the sheet grows with the task instead of
                with the app's feature list. */}
            <div className="-mb-1 flex gap-1 border-b border-border">
              {(["task", "more"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    "-mb-px border-b-2 px-2.5 pb-1.5 pt-1 text-sm transition-colors",
                    tab === t
                      ? "border-primary font-medium text-foreground"
                      : "border-transparent text-muted hover:text-foreground"
                  )}
                >
                  {t === "task" ? "Task" : "More"}
                </button>
              ))}
            </div>

            {/* ══ TASK ══ what she sets often, in the order she sets it ════ */}
            <div className={cn("flex flex-col gap-4", tab !== "task" && "hidden")}>
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

            {/* THE TWO DATES, side by side at the top. Her ask, and the
                distinction is the point: DUE is when the task is owed and
                changing it means renegotiating a commitment, PLANNED is the day
                I mean to sit down with it and it moves around freely. They were
                collapsed into one field plus an "Add to Today" button, which
                could only ever set the planned date to today, so the date that
                shifts most was the one you could not choose.

                Both are set often, so both are plain pickers rather than one
                hiding behind the other. The due TIME stays a small popover that
                only appears once a due date exists. ───────────────────────── */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <span
                className="text-[11px] text-subtle"
                title="When this is owed. A deadline: moving it means moving a commitment."
              >
                Due
              </span>
              <span
                className="text-[11px] text-subtle"
                title="The day I mean to work on this. Free to shift; it is not a deadline. Setting it to today is what puts the task in Today, and an unfinished plan carries forward until it is done or removed."
              >
                Planned
              </span>
              <div className="flex min-w-0 items-center gap-1.5">
                <div className="min-w-0 flex-1">
                  <DueDatePicker
                    value={dueDate}
                    placeholder="No deadline"
                    onChange={(v) => {
                      setDueDate(v);
                      // Clearing the date clears any time with it: a bare time is
                      // meaningless, and would keep the popover showing "14:00"
                      // against no day.
                      if (!v && dueTime) {
                        setDueTime("");
                        save({ due_date: null, due_time: null });
                      } else {
                        save({ due_date: v || null });
                      }
                    }}
                    onDateTime={(date, time) => {
                      setDueDate(date);
                      const body: Record<string, unknown> = { due_date: date };
                      if (time) {
                        setDueTime(time);
                        body.due_time = time;
                      }
                      save(body);
                    }}
                  />
                </div>
                {dueDate && (
                  <DueTimePopover
                    value={dueTime}
                    onChange={(v) => {
                      setDueTime(v);
                      save({ due_time: v || null });
                    }}
                  />
                )}
              </div>
              <div className="min-w-0">
                <DueDatePicker
                  value={plannedDate}
                  placeholder="Not planned"
                  onChange={(v) => {
                    setPlannedDate(v);
                    save({ planned_date: v || null });
                  }}
                  onDateTime={(date) => {
                    setPlannedDate(date);
                    save({ planned_date: date });
                  }}
                />
              </div>
            </div>

            {/* Add to Today: one of the most-used actions, so it lives up top,
                always visible. It is a shortcut on the planned date above (it
                writes today into it), kept as its own button because Remove
                does more than clear a field: it also clears the other reasons
                the view is holding the task, and defers the ones it cannot
                clear. ──────────────────────────────────────────────────── */}
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

                {/* Optional, in BOTH directions, on the main page. Her ask, and
                    it overrides the usage rule that put the "set it" half on
                    More (optional is set on 2% of tasks): deciding a task is a
                    nice-to-have is a decision you make WHILE looking at the
                    task, so making you cross a tab to record it is the wrong
                    trade even at that rate. The estimate went the other way, to
                    More, on the same instruction. */}
                <button
                  type="button"
                  title={
                    optional
                      ? "Optional: a nice-to-have, not a commitment. Click to make it a commitment again."
                      : "Optional: a nice-to-have, not a commitment"
                  }
                  onClick={() => {
                    const next = !optional;
                    setOptional(next);
                    // D1 has no boolean type, so store 0/1.
                    save({ optional: next ? 1 : 0 });
                  }}
                  className={cn(
                    "inline-flex w-fit items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1.5 text-sm font-medium transition-colors",
                    optional
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input text-muted hover:border-primary/50 hover:bg-surface-2"
                  )}
                >
                  {optional ? "Optional" : "Mark optional"}
                </button>
              </div>
            )}

            {/* Rare fields that ARE set on this task. They live on More, but a
                value must never be invisible: each one says what it is here and
                takes you to its control. This row is empty on most tasks, which
                is the point. */}
            {promoted.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {promoted.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setTab("more")}
                    title={`${p.label} — open More to change it`}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted transition-colors hover:border-primary/50 hover:text-foreground"
                  >
                    <p.Icon className="h-3 w-3" />
                    {p.label}
                  </button>
                ))}
              </div>
            )}

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

            {/* Steps. 11% of tasks have any, and the rest were paying a heading,
                a progress bar, a text input and an Add button to say so. No
                steps means one dashed chip, which opens the input. */}
            {subtasks.length === 0 && !addingSub ? (
              <button
                type="button"
                onClick={() => setAddingSub(true)}
                className="inline-flex w-fit items-center gap-1 rounded-full border border-dashed border-input px-2.5 py-1 text-[11.5px] text-subtle transition-colors hover:border-primary/50 hover:text-foreground"
              >
                <AddIcon className="h-3 w-3" />
                Step
              </button>
            ) : (
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
                    <SubtaskTitle
                      value={s.title}
                      done={s.done}
                      onSave={(t) => t !== s.title && editSub(s.id, { title: t })}
                    />
                    {/* Per-subtask priority and due date. Both are usually
                        unset (16 of her 103 steps carry a date), and both used
                        to render at full strength regardless, so a task with
                        three steps showed three empty date fields. Unset now
                        means a mark that appears on hover; set means the value,
                        always visible. */}
                    <button
                      type="button"
                      title="Cycle priority"
                      onClick={() => editSub(s.id, { priority: nextPriority(s.priority) })}
                      className="shrink-0"
                    >
                      {shouldPill(s.priority) ? (
                        <PriorityPill priority={s.priority} />
                      ) : (
                        // Unset: no border and no box, just a faint letter. Same
                        // hit area, a fraction of the visual weight.
                        <span className="grid h-5 min-w-[1.25rem] place-items-center text-[10px] text-subtle/60 transition-colors hover:text-foreground">
                          P
                        </span>
                      )}
                    </button>
                    <SubtaskDate
                      value={s.due_date ?? null}
                      onChange={(v) => editSub(s.id, { due_date: v })}
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
                  autoFocus={addingSub && subtasks.length === 0}
                  placeholder="Add subtask — try 'post the form fri p1'"
                  className="h-9 flex-1 rounded-md border border-input bg-surface px-3 text-sm text-foreground outline-none focus:border-primary"
                />
                <Button variant="secondary" size="sm" onClick={addSub}>
                  <AddIcon className="h-4 w-4" /> Add
                </Button>
              </div>
              {/* What the parser will do, shown BEFORE it does it. Capture
                  parsing used to fire invisibly on subtasks: no pills, no way
                  to keep "fri" as a word. Chips preview the schedule; "keep as
                  text" turns parsing off for this sheet. */}
              {(subParsed || rawSub) && newSub.trim() !== "" && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px]">
                  {!rawSub && subParse.due_date && (
                    <span className="rounded border border-primary/40 px-1 text-primary/90">
                      due {subParse.due_date}
                    </span>
                  )}
                  {!rawSub && subParse.priority != null && (
                    <span className="rounded border border-warning/40 px-1 text-warning">
                      P{subParse.priority}
                    </span>
                  )}
                  {rawSub && (
                    <span className="text-subtle">adding exactly as typed</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setRawSub((r) => !r)}
                    className="rounded border border-border px-1.5 py-0.5 text-subtle transition-colors hover:text-foreground"
                  >
                    {rawSub ? "parse dates again" : "keep as text"}
                  </button>
                </div>
              )}
            </div>
            )}

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

            {/* Connections. Blocked-by is set on 8% of tasks and waiting-on on
                1%, which would put both on More, but she asked for them where
                she can reach them. So they sit under the work, and each renders
                as ONE dashed chip until it holds something: on a task with no
                connections this whole block is a single line of three chips
                that wrap in beside the "+ Step" one. Related links are new, so
                there is no rate to argue from yet. */}
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <BlockersEditor task={task} />
              <BlockedUntilEditor task={task} />
              <WaitingOnEditor task={task} />
              <RelatedEditor task={task} />
            </div>

            </div>
            {/* ══ MORE ══ everything set on fewer than one task in ten. Nothing
                here is hidden while it holds a value: a set field also shows as
                a chip on Task. ═════════════════════════════════════════════ */}
            <div className={cn("flex flex-col gap-4", tab !== "more" && "hidden")}>

            {/* ── Scheduling: repeat (2%), snooze (2%), check-in (0.2%) and the
                time block (4%). All were on the main sheet, each costing a line
                on every task, to serve a case that comes up on one task in
                fifty. ──────────────────────────────────────────────────── */}
            <div className="space-y-3">
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
                <span
                  className="flex w-fit cursor-help items-center gap-1.5 text-xs text-muted underline decoration-dotted decoration-from-font underline-offset-2"
                  title="Snooze: hide this task completely until a chosen day. It asks for nothing in the meantime and comes back untouched."
                >
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
                <span
                  className="flex w-fit cursor-help items-center gap-1.5 text-xs text-muted underline decoration-dotted decoration-from-font underline-offset-2"
                  title={
                    "Repeat: runs on a schedule. Completing it rolls the task to its next occurrence instead of finishing it.\n\n" +
                    "Not the same as a checkpoint (which nudges you about ONE task on its way to a due date), or a cadence (sidebar: things that reset whenever you do them, like calling mum or watering the plants)."
                  }
                >
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
                {/* End conditions + skip. "After N times" stores occurrences
                    REMAINING; the roll that reaches zero completes for real. */}
                {recurrence && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      value={recEnd}
                      onChange={(e) => {
                        const v = e.target.value as "" | "count" | "until";
                        setRecEnd(v);
                        if (v === "") {
                          setRecCount("");
                          setRecUntil("");
                          save({ recurrence_count: null, recurrence_until: null });
                        }
                      }}
                      className="h-8 rounded-md border border-input bg-surface px-2 text-xs text-foreground outline-none focus:border-primary"
                    >
                      <option value="">Ends never</option>
                      <option value="count">after N times</option>
                      <option value="until">on a date</option>
                    </select>
                    {recEnd === "count" && (
                      <input
                        type="number"
                        min={1}
                        value={recCount}
                        onChange={(e) => {
                          const n = e.target.value === "" ? "" : Math.max(1, Number(e.target.value));
                          setRecCount(n);
                          save({
                            recurrence_count: n === "" ? null : n,
                            recurrence_until: null,
                          });
                        }}
                        placeholder="N"
                        className="h-8 w-16 rounded-md border border-input bg-surface px-2 text-xs text-foreground outline-none focus:border-primary"
                        title="Occurrences remaining"
                      />
                    )}
                    {recEnd === "until" && (
                      <input
                        type="date"
                        value={recUntil}
                        onChange={(e) => {
                          setRecUntil(e.target.value);
                          save({
                            recurrence_until: e.target.value || null,
                            recurrence_count: null,
                          });
                        }}
                        className="h-8 rounded-md border border-input bg-surface px-2 text-xs text-foreground outline-none focus:border-primary"
                        title="Last day an occurrence may land on"
                      />
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        const r = await api.skipOccurrence(task.id);
                        invalidate();
                        toast(
                          r.ended
                            ? "That was the last occurrence: repeat ended"
                            : `Skipped · next ${r.due_date}`
                        );
                      }}
                      className="h-8 rounded-md bg-surface-2 px-2 text-xs text-foreground transition-colors hover:bg-surface-2/70"
                      title="Move to the next occurrence without completing this one"
                    >
                      Skip occurrence
                    </button>
                  </div>
                )}
              </div>

              {/* Checkpoints: surface a long-horizon task in Today every N days
                  to check it is on track, without moving its due date. */}
              <CheckpointControl task={task} save={save} today={todayStr()} />

              {/* The app has three repetition mechanisms and this is the one
                  place two of them sit together, so this is where the signpost
                  lives. It used to be a paragraph under all three, spending four
                  permanent lines to answer a question you ask once. Each heading
                  is now dotted-underlined and carries the explanation on hover,
                  including what it is NOT, which is the part that was actually
                  doing the work. */}
            </div>

            {/* Estimate + timer. The estimate was on Task (14% of tasks carry
                one, above the 1-in-10 line) and she moved it here: it is the
                number you set when you are planning the work, not when you are
                reading the task, and it was the field making the top of the
                sheet busy. Set, it still shows as a chip on Task, so a value is
                never hidden. It sits with the TIMER because they are the same
                measurement, estimated and actual. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3">
              <label className="flex items-center gap-1.5 text-xs text-subtle">
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
                  className="h-8 w-14 rounded-md border border-input bg-surface px-2 text-xs text-foreground outline-none focus:border-primary"
                />
                min estimate
              </label>
              <TimeTracker task={task} />
              <span className="text-xs text-subtle">
                {task.time_spent_min > 0 ? `${task.time_spent_min}m spent` : "no time logged"}
              </span>
            </div>

            {/* Files and the note this task came from. */}
            <div className="space-y-3 border-t border-border pt-3">
              <AttachmentList taskId={task.id} />
              {/* Vault-born tasks link back to their note. Vault name is fixed:
                  single-user app, her vault is "Workspace". */}
              {task.source_path && (
                <a
                  href={`obsidian://open?vault=Workspace&file=${encodeURIComponent(task.source_path)}`}
                  className="flex items-center gap-1.5 text-xs text-subtle transition-colors hover:text-primary"
                  title={`Open in Obsidian${task.source_line ? ` (line ${task.source_line})` : ""}${task.vault_dirty ? " · note not yet updated with the latest change" : ""}`}
                >
                  <NotesIcon className="h-3.5 w-3.5" />
                  From note: {task.source_path}
                  {!!task.vault_dirty && <span className="text-warning">· sync pending</span>}
                </a>
              )}
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
          </div>
        )}
        {/* The open-steps question, for completing from in here. */}
        {guardDialog}
      </SheetContent>
    </Sheet>
  );
}
