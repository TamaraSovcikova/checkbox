import { useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { Project, Task } from "../../shared/types";
import { useTasks, useToggleSubtask } from "../lib/queries";
import { TaskRow } from "./TaskRow";
import { areaTintBg } from "../lib/colors";
import { SubtaskIcon, ChevronDownIcon, ChevronRightIcon, CheckIcon } from "../lib/icons";
import { type RowSelection, type TaskControls, BulkActionBar, useTaskSelection } from "./TaskListControls";
import {
  TaskMeta,
  TodayToggle,
  optionalCardBorder,
  optionalTitleTone,
  useTaskArea,
  useDistantTone,
  dormantTone,
} from "./TaskMeta";
import { cn, todayStr } from "@/lib/utils";
import { useTaskHover } from "./TaskHoverCard";
import { useFocusTask, FOCUS_RING } from "../lib/use-focus-task";
import { isSubtaskLed, leadingSubtasks } from "../lib/today";

// Draggable board card. Drops resolve in the app-level DndContext (AppShell),
// so a card can go to another column OR onto a sidebar area/project.
//
// Chips + the Today marker come from TaskMeta/TodayToggle, the same pieces the
// list rows use, so a card in a project board carries the same signals as the
// same task in a list. It used to render its own four-chip subset, which is why
// `optional` and Today were invisible on any board.
export function BoardCard({
  task,
  onOpen,
  selection,
}: {
  task: Task;
  onOpen: (t: Task) => void;
  // Multi-select on boards (#2), the same selection the lists use: Ctrl/Cmd-
  // click toggles, Shift-click selects a range, and once anything is selected a
  // plain click extends the selection instead of opening.
  selection?: RowSelection;
}) {
  // Subtasks unfold ON the card: a board where every step needs a trip through
  // the sheet hides half the work. Full titles wrap; the toggle is dnd-safe
  // (pointer-down stopped, same trick as the Today toggle).
  const [showSubs, setShowSubs] = useState(false);
  const toggleSub = useToggleSubtask();
  const subs = task.subtasks ?? [];
  const subsDone = subs.filter((s) => s.done).length;
  // A card whose only claim on today is a step reads as that step, with the task
  // above it as context. Same rule and same shape as the list row, so the Today
  // board and the Today list say the same thing about the same task.
  const stepLed = isSubtaskLed(task, todayStr());
  const leadSteps = stepLed ? leadingSubtasks(task, todayStr()) : [];
  const restSubs = subs.filter((s) => !leadSteps.some((l) => l.id === s.id));
  // Area resolved through the project, so a card is tinted whenever the same task
  // in a list would be. Far-future dimming shared with the row, so a board card
  // and a list row of the same task recede together.
  const { area } = useTaskArea(task);
  const tint = areaTintBg(area?.color, 12);
  const distant = useDistantTone(task);
  const done = task.status === "done";
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id, data: { type: "task", task } });
  // Same hover preview as the list rows, so a card and a row of the same task
  // answer the same question at rest.
  const { hoverProps, card } = useTaskHover(task, isDragging);
  // Same jump-and-flash as the list row, so Navigate behaves identically
  // whichever view mode the destination page happens to be showing.
  const { lit } = useFocusTask(task.id);
  return (
    <div
      ref={setNodeRef}
      // How the focus scroll finds this card. See lib/use-focus-task.
      data-task-id={task.id}
      style={{
        ...(transform
          ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
          : {}),
        ...(tint ? { backgroundColor: tint } : {}),
      }}
      onClick={(e) => (selection ? selection.onRowClick(e) : onOpen(task))}
      aria-selected={selection ? selection.selected : undefined}
      className={cn(
        "group touch-none rounded-md border border-border bg-surface p-2 transition-colors hover:border-primary/40",
        selection?.selected && "border-primary ring-2 ring-primary/60",
        isDragging ? "cursor-grabbing opacity-50" : "cursor-grab",
        !isDragging && distant,
        !isDragging && dormantTone(task, todayStr()),
        lit && FOCUS_RING,
        optionalCardBorder(task)
      )}
      {...attributes}
      {...listeners}
      {...hoverProps}
    >
      {card}
      <div className="flex items-start gap-1.5">
        {selection && (
          // The way into selection without a keyboard: shown on hover, always
          // once something is selected, always on touch screens.
          <button
            type="button"
            role="checkbox"
            aria-checked={selection.selected}
            aria-label={`Select ${task.title}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              selection.onToggle();
            }}
            className={cn(
              "mt-0.5 h-4 w-4 shrink-0 place-items-center rounded border transition-colors",
              selection.selected
                ? "grid border-primary bg-primary text-[var(--primary-foreground)]"
                : cn(
                    "border-subtle/70 hover:border-primary",
                    selection.active ? "grid" : "hidden group-hover:grid max-md:grid"
                  )
            )}
          >
            {selection.selected && <CheckIcon className="h-3 w-3" strokeWidth={3} />}
          </button>
        )}
        {stepLed ? (
          <div className="min-w-0 flex-1">
            <div
              className="flex items-center gap-1 text-[11px] leading-tight text-subtle"
              title={`Part of: ${task.title}`}
            >
              <SubtaskIcon className="h-3 w-3 shrink-0" />
              <span className="truncate">{task.title}</span>
            </div>
            <ul
              className="mt-1 space-y-1"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {leadSteps.map((s) => (
                <li key={s.id} className="flex items-start gap-1.5">
                  <input
                    type="checkbox"
                    checked={false}
                    aria-label={s.title}
                    onChange={() =>
                      toggleSub.mutate({ taskId: task.id, subId: s.id, done: true })
                    }
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 [accent-color:var(--primary)]"
                  />
                  <span className="min-w-0 flex-1 text-sm leading-snug text-foreground">
                    {s.title}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div
            className={cn(
              "min-w-0 flex-1 text-sm",
              done ? "text-subtle line-through" : "text-foreground",
              optionalTitleTone(task)
            )}
          >
            {task.title}
          </div>
        )}
        {!done && <TodayToggle task={task} alwaysVisible />}
      </div>
      {/* The column heading already says Doing, so the chip would only repeat it. */}
      <TaskMeta task={task} hideDoing hideDueSubs={stepLed} />
      {restSubs.length > 0 && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setShowSubs((v: boolean) => !v);
          }}
          className={cn(
            "mt-1 inline-flex items-center gap-1 text-[11px] transition-colors hover:text-foreground",
            subsDone === subs.length ? "text-primary" : "text-subtle"
          )}
        >
          <SubtaskIcon className="h-3 w-3" />
          {subsDone}/{subs.length}
          {showSubs ? <ChevronDownIcon className="h-3 w-3" /> : <ChevronRightIcon className="h-3 w-3" />}
        </button>
      )}
      {showSubs && restSubs.length > 0 && (
        <ul
          className="mt-1 space-y-1 border-t border-border pt-1.5"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {restSubs.map((s) => (
            <li key={s.id} className="flex items-start gap-1.5 text-[12px] leading-snug">
              <input
                type="checkbox"
                checked={s.done}
                aria-label={s.title}
                onChange={(e) =>
                  toggleSub.mutate({ taskId: task.id, subId: s.id, done: e.target.checked })
                }
                className="mt-0.5 h-3.5 w-3.5 shrink-0 [accent-color:var(--primary)]"
              />
              <span className={cn("min-w-0 flex-1", s.done && "text-subtle line-through")}>
                {s.title}
              </span>
              {s.due_date && (
                <span className="shrink-0 text-[10px] text-primary">{s.due_date.slice(5)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Selection for a board: the list's selection hook over the cards in on-screen
// order (column by column), so Shift-click ranges run the way the eye reads.
// Keyboard navigation stays off: j/k have no obvious meaning across columns.
export function useBoardSelection(ordered: Task[], onOpen: (t: Task) => void) {
  const controls = useTaskSelection(ordered, onOpen, false);
  const index = new Map(ordered.map((t, i) => [t.id, i]));
  const selectionFor = (t: Task) => controls.rowFor(t, index.get(t.id) ?? 0);
  return { controls, selectionFor };
}

// The bulk bar and the complete-guard dialog for a board.
export function BoardSelectionChrome({ controls }: { controls: TaskControls }) {
  return (
    <>
      <BulkActionBar controls={controls} />
      {controls.dialog}
    </>
  );
}

function Column({
  projectId,
  name,
  done,
  tasks,
  onOpen,
  selectionFor,
}: {
  projectId: string;
  name: string;
  done: boolean;
  tasks: Task[];
  onOpen: (t: Task) => void;
  selectionFor: (t: Task) => RowSelection;
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
      <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-muted">
        {name} <span className="text-subtle">{tasks.length}</span>
      </h2>
      {tasks.map((t) => (
        <BoardCard key={t.id} task={t} onOpen={onOpen} selection={selectionFor(t)} />
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
  const byColumn = columns.map((col) => tasks.filter((t) => colOf(t) === col));
  const { controls, selectionFor } = useBoardSelection(byColumn.flat(), onOpen);

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
          tasks={byColumn[i]}
          onOpen={onOpen}
          selectionFor={selectionFor}
        />
      ))}
      <BoardSelectionChrome controls={controls} />
    </div>
  );
}
