import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { Project, Task } from "../../shared/types";
import { useTasks } from "../lib/queries";
import { TaskRow } from "./TaskRow";
import { PRIORITY_VAR } from "../lib/colors";
import { cn } from "@/lib/utils";

// Draggable board card. Drops resolve in the app-level DndContext (AppShell),
// so a card can go to another column OR onto a sidebar area/project.
function Card({ task, onOpen }: { task: Task; onOpen: (t: Task) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id, data: { type: "task", task } });
  return (
    <div
      ref={setNodeRef}
      style={
        transform
          ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
          : undefined
      }
      onClick={() => onOpen(task)}
      className={cn(
        "cursor-pointer rounded-md border border-border bg-surface p-2 transition-colors hover:border-primary/40",
        isDragging && "opacity-50"
      )}
      {...attributes}
      {...listeners}
    >
      <div className="text-sm text-foreground">{task.title}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-subtle">
        <span style={{ color: PRIORITY_VAR[task.priority] }}>P{task.priority}</span>
        {task.due_date && <span className="text-primary">{task.due_date}</span>}
        {(task.labels ?? []).map((l) => (
          <span key={l.id} className="text-muted">
            @{l.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function Column({
  projectId,
  name,
  done,
  tasks,
  onOpen,
}: {
  projectId: string;
  name: string;
  done: boolean;
  tasks: Task[];
  onOpen: (t: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${projectId}:${name}`,
    data: { type: "column", column: name, done },
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-surface/40 p-2",
        isOver && "ring-1 ring-primary"
      )}
    >
      <div className="px-1 text-xs font-medium uppercase tracking-wide text-muted">
        {name} <span className="text-subtle">{tasks.length}</span>
      </div>
      {tasks.map((t) => (
        <Card key={t.id} task={t} onOpen={onOpen} />
      ))}
    </div>
  );
}

export function ProjectBoard({
  project,
  view = "grid",
  onOpen,
  transform,
}: {
  project: Project;
  view?: "grid" | "list";
  onOpen: (t: Task) => void;
  // Applied after fetch so the page's Filter/Sort menus affect both the board
  // columns and the list. The board still groups by column, so grouping is the
  // page's job only in list mode.
  transform?: (tasks: Task[]) => Task[];
}) {
  const { data: raw = [] } = useTasks({ project_id: project.id });
  const tasks = transform ? transform(raw) : raw;
  const columns = project.board_columns;

  function colOf(t: Task) {
    return t.board_column && columns.includes(t.board_column)
      ? t.board_column
      : columns[0];
  }

  if (view === "list") {
    return (
      <div className="max-w-2xl">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} onOpen={onOpen} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((col, i) => (
        <Column
          key={col}
          projectId={project.id}
          name={col}
          done={i === columns.length - 1}
          tasks={tasks.filter((t) => colOf(t) === col)}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
