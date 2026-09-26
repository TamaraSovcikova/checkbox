import { useDroppable } from "@dnd-kit/core";
import type { Task, TaskStatus } from "../../shared/types";
import { useTaskUI } from "../lib/ui-context";
import { cn } from "@/lib/utils";
import { BoardCard, useBoardSelection, BoardSelectionChrome } from "./ProjectBoard";
import type { RowSelection } from "./TaskListControls";

// The three stages of the Today board. Each maps straight to task.status, so
// dragging a card between columns is just a status change (Done routes through
// the complete endpoint - see resolveDrop's "stage" case).
const STAGES: { stage: TaskStatus; label: string }[] = [
  { stage: "todo", label: "To do" },
  { stage: "doing", label: "Doing" },
  { stage: "done", label: "Done" },
];

function StageColumn({
  stage,
  label,
  tasks,
  onOpen,
  selectionFor,
}: {
  stage: TaskStatus;
  label: string;
  tasks: Task[];
  onOpen: (t: Task) => void;
  selectionFor: (t: Task) => RowSelection;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `stage:${stage}`,
    data: { type: "stage", stage },
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        // Share the width rather than claiming a fixed 288px each. Fixed columns
        // meant widening the rail pushed a whole column out of sight instead of
        // making the remaining ones narrower, so the divider could silently cost
        // you a third of the board. `min-w` is the floor at which a card stops
        // being readable; past that the row scrolls, which is the honest
        // fallback rather than squeezing to nothing.
        "flex min-w-[11rem] flex-1 flex-col gap-2 rounded-lg bg-surface/40 p-2",
        isOver && "ring-1 ring-primary"
      )}
    >
      <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-muted">
        {label} <span className="text-subtle">{tasks.length}</span>
      </h2>
      {tasks.map((t) => (
        <BoardCard key={t.id} task={t} onOpen={onOpen} selection={selectionFor(t)} />
      ))}
      {tasks.length === 0 && (
        <p className="px-1 py-6 text-center text-[11px] text-subtle">
          Drop a task here
        </p>
      )}
    </div>
  );
}

// Board layout for Today: the open tasks (todo + doing) plus the tasks completed
// today, split into three draggable columns. `open` are the todo/doing tasks
// from the Today view; `done` are today's completed tasks (a separate view, so
// the Done column stays populated even though Today excludes done tasks).
export function TodayBoard({ open, done }: { open: Task[]; done: Task[] }) {
  const { open: openTask } = useTaskUI();
  const byStage: Record<TaskStatus, Task[]> = {
    todo: open.filter((t) => t.status !== "doing"),
    doing: open.filter((t) => t.status === "doing"),
    done,
  };
  const { controls, selectionFor } = useBoardSelection(
    STAGES.flatMap(({ stage }) => byStage[stage]),
    openTask
  );
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {STAGES.map(({ stage, label }) => (
        <StageColumn
          key={stage}
          stage={stage}
          label={label}
          tasks={byStage[stage]}
          onOpen={openTask}
          selectionFor={selectionFor}
        />
      ))}
      <BoardSelectionChrome controls={controls} />
    </div>
  );
}
