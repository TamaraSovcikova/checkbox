import { useDraggable } from "@dnd-kit/core";
import type { Task } from "../../shared/types";
import { useCompleteTask } from "../lib/queries";
import { useToast } from "../lib/toast";
import { recurrenceLabel } from "../../shared/recurrence";
import { PRIORITY_VAR } from "../lib/colors";
import { cn } from "@/lib/utils";
import { DragIcon, CheckIcon, RepeatIcon } from "../lib/icons";
import type { RowSelection } from "./TaskListControls";

export function TaskRow({
  task,
  onOpen,
  selection,
}: {
  task: Task;
  onOpen: (t: Task) => void;
  selection?: RowSelection;
}) {
  const complete = useCompleteTask();
  const { toast } = useToast();
  const done = task.status === "done";
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { type: "task", task },
  });

  async function onComplete() {
    const res = await complete.mutateAsync({ id: task.id, done: !done });
    if (done) return; // was un-completing
    if (res?.recurred && res.due_date) {
      toast(`Recurring — next on ${res.due_date}`);
    } else {
      toast("Completed", () => complete.mutate({ id: task.id, done: false }));
    }
  }

  return (
    <div
      className={cn(
        "group flex items-start gap-1 rounded-md px-2 py-1.5 transition-colors",
        selection?.cursor
          ? "bg-surface-2/70 ring-1 ring-primary/50"
          : selection?.selected
          ? "bg-primary/10"
          : "hover:bg-surface-2/50",
        isDragging && "opacity-40"
      )}
    >
      {/* multi-select checkbox — appears on hover or while a selection is active */}
      <button
        aria-label={selection?.selected ? "Deselect" : "Select"}
        onClick={(e) => {
          e.stopPropagation();
          selection?.onToggle();
        }}
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0 place-items-center rounded border transition-colors",
          selection?.selected
            ? "grid border-primary bg-primary text-primary-foreground"
            : selection?.active
            ? "grid border-input hover:border-primary"
            : "hidden group-hover:grid border-input hover:border-primary"
        )}
      >
        {selection?.selected && <CheckIcon className="h-2.5 w-2.5" />}
      </button>

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
        onClick={onComplete}
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

      <button
        onClick={(e) => (selection ? selection.onRowClick(e) : onOpen(task))}
        className="flex-1 text-left"
      >
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
          {task.recurrence && (
            <span className="inline-flex items-center gap-0.5 text-muted">
              <RepeatIcon className="h-3 w-3" />
              {recurrenceLabel(task.recurrence)}
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
