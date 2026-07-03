import { useDraggable } from "@dnd-kit/core";
import type { Task } from "../../shared/types";
import { useCompleteTask } from "../lib/queries";
import { PRIORITY_VAR } from "../lib/colors";
import { cn } from "@/lib/utils";
import { DragIcon, CheckIcon } from "../lib/icons";

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
      className={cn(
        "group flex items-start gap-1 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-2/50",
        isDragging && "opacity-40"
      )}
    >
      <button
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        aria-label="Drag task"
        title="Drag to an area, project, or view"
        className="mt-0.5 hidden w-4 shrink-0 cursor-grab place-items-center text-subtle hover:text-foreground group-hover:grid"
      >
        <DragIcon className="h-3.5 w-3.5" />
      </button>
      <button
        aria-label="Complete"
        onClick={() => complete.mutate({ id: task.id, done: !done })}
        className={cn(
          "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-colors",
          done
            ? "border-primary bg-primary text-primary-foreground"
            : "hover:border-primary"
        )}
        style={done ? undefined : { borderColor: PRIORITY_VAR[task.priority] }}
      >
        {done && <CheckIcon className="h-2.5 w-2.5" />}
      </button>

      <button onClick={() => onOpen(task)} className="flex-1 text-left">
        <div className={cn("text-sm text-foreground", done && "text-subtle line-through")}>
          {task.title}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-subtle">
          {task.due_date && (
            <span className="text-primary">
              {task.due_date}
              {task.due_time ? ` ${task.due_time}` : ""}
            </span>
          )}
          {task.time_estimate_min && <span>{task.time_estimate_min}m</span>}
          {(task.labels ?? []).map((l) => (
            <span key={l.id} className="text-muted">
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
