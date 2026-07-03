import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { Project, Task } from "../../shared/types";
import { useTasks, useUpdateTask } from "../lib/queries";
import { TaskRow } from "./TaskRow";
import { cx } from "./ui";

function Card({ task, onOpen }: { task: Task; onOpen: (t: Task) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      style={
        transform
          ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
          : undefined
      }
      className={cx(
        "rounded-md border border-slate-800 bg-slate-900 p-2",
        isDragging && "opacity-50"
      )}
      {...attributes}
      {...listeners}
    >
      <div className="text-sm">{task.title}</div>
      <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
        <span className={`pri-${task.priority}`}>P{task.priority}</span>
        {task.due_date && <span className="text-sky-400">{task.due_date}</span>}
        {(task.labels ?? []).map((l) => (
          <span key={l.id} className="text-violet-400">
            @{l.name}
          </span>
        ))}
      </div>
      <button
        onClick={() => onOpen(task)}
        className="mt-1 text-[11px] text-slate-500 hover:text-slate-300"
      >
        open
      </button>
    </div>
  );
}

function Column({
  name,
  tasks,
  onOpen,
}: {
  name: string;
  tasks: Task[];
  onOpen: (t: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: name });
  return (
    <div
      ref={setNodeRef}
      className={cx(
        "flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-slate-900/40 p-2",
        isOver && "ring-1 ring-sky-500"
      )}
    >
      <div className="px-1 text-xs font-medium uppercase tracking-wide text-slate-400">
        {name} <span className="text-slate-600">{tasks.length}</span>
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
}: {
  project: Project;
  view?: "grid" | "list";
  onOpen: (t: Task) => void;
}) {
  const { data: tasks = [] } = useTasks({ project_id: project.id });
  const update = useUpdateTask();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );
  const columns = project.board_columns;

  function colOf(t: Task) {
    return t.board_column && columns.includes(t.board_column)
      ? t.board_column
      : columns[0];
  }

  function onDragEnd(e: DragEndEvent) {
    const col = e.over?.id as string | undefined;
    if (!col) return;
    const task = tasks.find((t) => t.id === e.active.id);
    if (!task || colOf(task) === col) return;
    const status = col === columns[columns.length - 1] ? "done" : "todo";
    update.mutate({ id: task.id, body: { board_column: col, status } });
  }

  return (
    <div>
      {view === "grid" ? (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {columns.map((col) => (
              <Column
                key={col}
                name={col}
                tasks={tasks.filter((t) => colOf(t) === col)}
                onOpen={onOpen}
              />
            ))}
          </div>
        </DndContext>
      ) : (
        <div className="max-w-2xl">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}
