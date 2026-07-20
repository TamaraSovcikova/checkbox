import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { Project, Task } from "../../shared/types";
import { useTasks } from "../lib/queries";
import { TaskRow } from "./TaskRow";
import { areaTintBg } from "../lib/colors";
import {
  TaskMeta,
  TodayToggle,
  optionalCardBorder,
  optionalTitleTone,
  useTaskArea,
  useDistantTone,
} from "./TaskMeta";
import { cn } from "@/lib/utils";

// Draggable board card. Drops resolve in the app-level DndContext (AppShell),
// so a card can go to another column OR onto a sidebar area/project.
//
// Chips + the Today marker come from TaskMeta/TodayToggle, the same pieces the
// list rows use, so a card in a project board carries the same signals as the
// same task in a list. It used to render its own four-chip subset, which is why
// `optional` and Today were invisible on any board.
export function BoardCard({ task, onOpen }: { task: Task; onOpen: (t: Task) => void }) {
  // Area resolved through the project, so a card is tinted whenever the same task
  // in a list would be. Far-future dimming shared with the row, so a board card
  // and a list row of the same task recede together.
  const { area } = useTaskArea(task);
  const tint = areaTintBg(area?.color, 12);
  const distant = useDistantTone(task);
  const done = task.status === "done";
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id, data: { type: "task", task } });
  return (
    <div
      ref={setNodeRef}
      style={{
        ...(transform
          ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
          : {}),
        ...(tint ? { backgroundColor: tint } : {}),
      }}
      onClick={() => onOpen(task)}
      className={cn(
        "group touch-none rounded-md border border-border bg-surface p-2 transition-colors hover:border-primary/40",
        isDragging ? "cursor-grabbing opacity-50" : "cursor-grab",
        !isDragging && distant,
        optionalCardBorder(task)
      )}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start gap-1.5">
        <div
          className={cn(
            "min-w-0 flex-1 text-sm",
            done ? "text-subtle line-through" : "text-foreground",
            optionalTitleTone(task)
          )}
        >
          {task.title}
        </div>
        {!done && <TodayToggle task={task} alwaysVisible />}
      </div>
      {/* The column heading already says Doing, so the chip would only repeat it. */}
      <TaskMeta task={task} hideDoing />
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
        // Same as TodayBoard: columns share the width instead of each claiming a
        // fixed 288px, so the board reflows when the rail divider moves. A
        // project can define many columns, in which case the min-w floor is hit
        // and the row scrolls, which is correct: five unreadable slivers help
        // nobody.
        "flex min-w-[11rem] flex-1 flex-col gap-2 rounded-lg bg-surface/40 p-2",
        isOver && "ring-1 ring-primary"
      )}
    >
      <div className="px-1 text-xs font-medium uppercase tracking-wide text-muted">
        {name} <span className="text-subtle">{tasks.length}</span>
      </div>
      {tasks.map((t) => (
        <BoardCard key={t.id} task={t} onOpen={onOpen} />
      ))}
    </div>
  );
}

export function ProjectBoard({
  project,
  view = "board",
  onOpen,
  transform,
}: {
  project: Project;
  // "board" was called "grid" until the card-grid mode was removed and the name
  // was freed up to mean what this actually draws.
  view?: "board" | "list";
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
      // Inside one project every task shares an area, so the area tint would say
      // nothing here; skip it and let the rows breathe instead.
      <div className="max-w-2xl space-y-1">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} onOpen={onOpen} tintArea={false} />
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
