import { useDraggable } from "@dnd-kit/core";
import type { Task } from "../../shared/types";
import { useCompleteTask } from "../lib/queries";
import { cx } from "./ui";

const PRI_DOT: Record<number, string> = {
  1: "pri-1",
  2: "pri-2",
  3: "pri-3",
  4: "pri-4",
};

export function TaskRow({
  task,
  onOpen,
}: {
  task: Task;
  onOpen: (t: Task) => void;
}) {
  const complete = useCompleteTask();
  const done = task.status === "done";
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { type: "task", task },
  });

  return (
    <div
      className={cx(
        "group flex items-start gap-1 rounded-md px-2 py-1.5 hover:bg-slate-800/50",
        isDragging && "opacity-40"
      )}
    >
      <button
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        aria-label="drag task"
        title="Drag to an area, project, or view"
        className="mt-0.5 hidden w-4 shrink-0 cursor-grab text-center text-slate-600 hover:text-slate-300 group-hover:block"
      >
        ⠿
      </button>
      <button
        aria-label="complete"
        onClick={() => complete.mutate({ id: task.id, done: !done })}
        className={cx(
          "mt-0.5 h-4 w-4 shrink-0 rounded-full border",
          done
            ? "border-sky-500 bg-sky-500"
            : cx("border-slate-600 hover:border-sky-400", PRI_DOT[task.priority])
        )}
      >
        {done && <span className="block text-[10px] leading-none text-white">✓</span>}
      </button>

      <button
        onClick={() => onOpen(task)}
        className="flex-1 text-left"
      >
        <div className={cx("text-sm", done && "text-slate-500 line-through")}>
          {task.title}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
          {task.due_date && (
            <span className="text-sky-400">
              {task.due_date}
              {task.due_time ? ` ${task.due_time}` : ""}
            </span>
          )}
          {task.time_estimate_min && <span>{task.time_estimate_min}m</span>}
          {(task.labels ?? []).map((l) => (
            <span key={l.id} className="text-violet-400">
              @{l.name}
            </span>
          ))}
          {(task.subtasks ?? []).length > 0 && (
            <span>
              {task.subtasks!.filter((s) => s.done).length}/{task.subtasks!.length}
            </span>
          )}
        </div>
      </button>
    </div>
  );
}
