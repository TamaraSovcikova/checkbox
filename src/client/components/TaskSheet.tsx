import { lazy, Suspense, useEffect, useState } from "react";
import { format, parseISO, addDays } from "date-fns";
import type { Task, Subtask } from "../../shared/types";
import { api } from "../lib/api";
import {
  PRIORITY_LABEL,
  useDeleteTask,
  useTaskInvalidate,
  useUpdateTask,
} from "../lib/queries";
import { RECURRENCE_PRESETS } from "../../shared/recurrence";
import { Markdown } from "../lib/markdown";
import { parseDatePhrase } from "../lib/nlp";
import { PRIORITY_VAR } from "../lib/colors";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Sheet, SheetContent } from "./ui/sheet";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { CalendarIcon, AddIcon, RepeatIcon, TrashIcon, SnoozeIcon } from "../lib/icons";
import { TimeTracker } from "./TimeTracker";
import { DependencyEditor } from "./DependencyEditor";
import { AttachmentList } from "./AttachmentList";
import { useSnoozeTask } from "../lib/queries";

// Lazy — react-day-picker only loads when a date picker is actually opened.
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
        {/* Quick presets — the common reschedules without opening the grid. */}
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

// Task detail editor. Was the hand-rolled TaskDrawer overlay; now a shadcn Sheet
// with a real date picker. Kept always mounted so open/close animates; content
// renders only when a task is selected.
export function TaskSheet({
  task,
  onClose,
}: {
  task: Task | null;
  onClose: () => void;
}) {
  const update = useUpdateTask();
  const del = useDeleteTask();
  const snooze = useSnoozeTask();
  const invalidate = useTaskInvalidate();

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
  const [more, setMore] = useState(false);
  const [newSub, setNewSub] = useState("");
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [nlpDate, setNlpDate] = useState("");

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
    setMore(false);
  }, [task]);

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
    await api.addSubtask(task.id, newSub.trim());
    setSubtasks((s) => [
      ...s,
      {
        id: crypto.randomUUID(),
        task_id: task.id,
        title: newSub.trim(),
        done: false,
        position: s.length,
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

  async function deleteSub(id: string) {
    if (!task) return;
    setSubtasks((s) => s.filter((x) => x.id !== id));
    await api.deleteSubtask(task.id, id);
    invalidate();
  }

  const subDone = subtasks.filter((s) => s.done).length;

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
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title !== task.title && save({ title })}
              className="w-full bg-transparent pr-8 text-lg font-semibold text-foreground outline-none"
            />

            {/* Notes: rendered markdown when idle, textarea on click/focus.
                Blur commits and returns to the rendered preview. */}
            {editingNotes || !notes.trim() ? (
              <textarea
                value={notes}
                autoFocus={editingNotes}
                onChange={(e) => setNotes(e.target.value)}
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

            {/* Inline NLP date — type a phrase, Enter (or ↵ button) to set. */}
            <input
              value={nlpDate}
              onChange={(e) => setNlpDate(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyNlpDate()}
              onBlur={applyNlpDate}
              placeholder="Type a date… e.g. next tue 3pm, in 2 weeks"
              className="h-8 w-full rounded-md border border-dashed border-input bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-subtle focus:border-primary"
            />

            {/* Snooze — hide until a chosen day. */}
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

            <div>
              <span className="text-xs text-muted">Priority</span>
              <div className="mt-1 flex gap-1">
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
                        "flex-1 rounded-md border px-2 py-1 text-xs transition-colors",
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
              </div>
              <p className="mt-1 text-[11px] text-subtle">
                {PRIORITY_LABEL[priority]}
              </p>
            </div>

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
                  Completing this task rolls it to the next occurrence instead of
                  finishing it.
                </p>
              )}
            </div>

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
                      className="h-4 w-4 [accent-color:var(--primary)]"
                    />
                    <span className={cn("flex-1", s.done && "text-subtle line-through")}>
                      {s.title}
                    </span>
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

            <TimeTracker task={task} />

            <DependencyEditor task={task} />

            <AttachmentList taskId={task.id} />

            <button
              onClick={() => setMore((m) => !m)}
              className="text-left text-xs text-muted hover:text-foreground"
            >
              {more ? "Hide" : "More"} options
            </button>
            {more && (
              <label className="text-xs text-muted">
                Time estimate (min)
                <input
                  type="number"
                  value={estimate}
                  onChange={(e) =>
                    setEstimate(e.target.value === "" ? "" : Number(e.target.value))
                  }
                  onBlur={() =>
                    save({ time_estimate_min: estimate === "" ? null : Number(estimate) })
                  }
                  className="mt-1 h-9 w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground outline-none focus:border-primary"
                />
              </label>
            )}

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
