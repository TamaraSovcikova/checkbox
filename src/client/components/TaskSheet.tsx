import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import type { Task, Subtask } from "../../shared/types";
import { api } from "../lib/api";
import {
  PRIORITY_LABEL,
  useDeleteTask,
  useTaskInvalidate,
  useUpdateTask,
} from "../lib/queries";
import { PRIORITY_VAR } from "../lib/colors";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Sheet, SheetContent } from "./ui/sheet";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { Calendar } from "./ui/calendar";
import { CalendarIcon, AddIcon } from "../lib/icons";

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
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => {
            onChange(d ? format(d, "yyyy-MM-dd") : "");
            setOpen(false);
          }}
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
  const invalidate = useTaskInvalidate();

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [priority, setPriority] = useState<Task["priority"]>(4);
  const [estimate, setEstimate] = useState<number | "">("");
  const [more, setMore] = useState(false);
  const [newSub, setNewSub] = useState("");
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setNotes(task.notes ?? "");
    setDueDate(task.due_date ?? "");
    setDueTime(task.due_time ?? "");
    setPriority(task.priority);
    setEstimate(task.time_estimate_min ?? "");
    setSubtasks(task.subtasks ?? []);
    setMore(false);
  }, [task]);

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

            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== (task.notes ?? "") && save({ notes })}
              placeholder="Notes..."
              rows={3}
              className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />

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
              <span className="text-xs text-muted">Subtasks</span>
              <div className="mt-1 space-y-1">
                {subtasks.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center gap-2 text-sm text-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={s.done}
                      onChange={(e) => toggleSub(s.id, e.target.checked)}
                      className="h-4 w-4 [accent-color:var(--primary)]"
                    />
                    <span className={cn(s.done && "text-subtle line-through")}>
                      {s.title}
                    </span>
                  </label>
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
