import { useEffect, useState } from "react";
import type { Task } from "../../shared/types";
import { api } from "../lib/api";
import {
  PRIORITY_LABEL,
  useDeleteTask,
  useTaskInvalidate,
  useUpdateTask,
} from "../lib/queries";
import { Button, Input, cx } from "./ui";

export function TaskDrawer({
  task,
  onClose,
}: {
  task: Task;
  onClose: () => void;
}) {
  const update = useUpdateTask();
  const del = useDeleteTask();
  const invalidate = useTaskInvalidate();

  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [dueTime, setDueTime] = useState(task.due_time ?? "");
  const [priority, setPriority] = useState(task.priority);
  const [estimate, setEstimate] = useState(task.time_estimate_min ?? "");
  const [more, setMore] = useState(false);
  const [newSub, setNewSub] = useState("");
  const [subtasks, setSubtasks] = useState(task.subtasks ?? []);

  useEffect(() => {
    setTitle(task.title);
    setNotes(task.notes ?? "");
    setDueDate(task.due_date ?? "");
    setDueTime(task.due_time ?? "");
    setPriority(task.priority);
    setEstimate(task.time_estimate_min ?? "");
    setSubtasks(task.subtasks ?? []);
  }, [task]);

  function save(body: Record<string, unknown>) {
    update.mutate({ id: task.id, body });
  }

  async function addSub() {
    if (!newSub.trim()) return;
    await api.addSubtask(task.id, newSub.trim());
    setSubtasks((s) => [
      ...s,
      { id: crypto.randomUUID(), task_id: task.id, title: newSub.trim(), done: false, position: s.length },
    ]);
    setNewSub("");
    invalidate();
  }

  async function toggleSub(id: string, done: boolean) {
    await api.updateSubtask(task.id, id, { done });
    setSubtasks((s) => s.map((x) => (x.id === id ? { ...x, done } : x)));
    invalidate();
  }

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="h-full w-[28rem] max-w-full overflow-y-auto border-l border-slate-800 bg-slate-950 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-slate-500">
            Task
          </span>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            ✕
          </button>
        </div>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== task.title && save({ title })}
          className="w-full bg-transparent text-lg font-medium outline-none"
        />

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== (task.notes ?? "") && save({ notes })}
          placeholder="Notes..."
          rows={3}
          className="mt-3 w-full resize-none rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-sky-500"
        />

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-400">
            Due date
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              onBlur={() => save({ due_date: dueDate || null })}
              className="mt-1"
            />
          </label>
          <label className="text-xs text-slate-400">
            Due time
            <Input
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              onBlur={() => save({ due_time: dueTime || null })}
              className="mt-1"
            />
          </label>
        </div>

        <div className="mt-4">
          <span className="text-xs text-slate-400">Priority</span>
          <div className="mt-1 flex gap-1">
            {[1, 2, 3, 4].map((p) => (
              <button
                key={p}
                onClick={() => {
                  setPriority(p as Task["priority"]);
                  save({ priority: p });
                }}
                className={cx(
                  "flex-1 rounded-md border px-2 py-1 text-xs",
                  priority === p
                    ? "border-sky-500 bg-sky-500/20 text-white"
                    : "border-slate-700 text-slate-400 hover:bg-slate-800"
                )}
              >
                P{p}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {PRIORITY_LABEL[priority]}
          </p>
        </div>

        {/* subtasks */}
        <div className="mt-5">
          <span className="text-xs text-slate-400">Subtasks</span>
          <div className="mt-1 space-y-1">
            {subtasks.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={s.done}
                  onChange={(e) => toggleSub(s.id, e.target.checked)}
                />
                <span className={cx(s.done && "text-slate-500 line-through")}>
                  {s.title}
                </span>
              </label>
            ))}
          </div>
          <div className="mt-1 flex gap-2">
            <Input
              value={newSub}
              onChange={(e) => setNewSub(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addSub()}
              placeholder="Add subtask"
            />
            <Button onClick={addSub}>Add</Button>
          </div>
        </div>

        {/* more */}
        <button
          onClick={() => setMore((m) => !m)}
          className="mt-5 text-xs text-slate-400 hover:text-slate-200"
        >
          {more ? "Hide" : "More"} options
        </button>
        {more && (
          <div className="mt-2">
            <label className="text-xs text-slate-400">
              Time estimate (min)
              <Input
                type="number"
                value={estimate}
                onChange={(e) => setEstimate(e.target.value)}
                onBlur={() =>
                  save({ time_estimate_min: estimate === "" ? null : Number(estimate) })
                }
                className="mt-1"
              />
            </label>
          </div>
        )}

        <div className="mt-6 border-t border-slate-800 pt-4">
          <Button
            variant="ghost"
            className="text-red-400 hover:bg-red-500/10"
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
  );
}
