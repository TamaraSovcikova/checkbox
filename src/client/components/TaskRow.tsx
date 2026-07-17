import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { Task } from "../../shared/types";
import {
  useAreas,
  useCompleteAllSubtasks,
  useCompleteTask,
  useToggleSubtask,
  useViewPrefs,
} from "../lib/queries";
import { useToast } from "../lib/toast";
import { PRIORITY_VAR, areaColorVar, areaTintBg, shouldPill } from "../lib/colors";
import { PriorityPill } from "./ui";
import { cn, todayStr, monthAheadStr } from "@/lib/utils";
import { isBlocked } from "../lib/blocked";
import { dueLabel } from "../lib/due";
import { hasSubtaskDueToday } from "../lib/today";
import { TaskMeta, TodayToggle, optionalTitleTone } from "./TaskMeta";
import {
  CheckIcon,
  SubtaskIcon,
  ChevronRightIcon,
  ChevronDownIcon,
} from "../lib/icons";
import { ConfirmSubtasksDialog } from "./ConfirmSubtasksDialog";
import type { RowSelection } from "./TaskListControls";

export function TaskRow({
  task,
  onOpen,
  selection,
  // Inside a single area or project every row would carry the SAME area colour,
  // which is just noise. Those pages pass false; mixed views (Today, Backlog,
  // Upcoming) keep it, which is where the colour actually tells you something.
  tintArea = true,
}: {
  task: Task;
  onOpen: (t: Task) => void;
  selection?: RowSelection;
  tintArea?: boolean;
}) {
  const complete = useCompleteTask();
  const toggleSub = useToggleSubtask();
  const completeAll = useCompleteAllSubtasks();
  const { dimDistantTasks } = useViewPrefs();
  const { data: areas = [] } = useAreas();
  const { toast } = useToast();
  // Where the task lives, for an at-a-glance colour. Cached query, so cheap per
  // row. (The chip strip resolves its own area/project label; this is only for
  // the wrapper's tint + accent bar.)
  const area = areas.find((a) => a.id === task.area_id);
  // Open the checklist on sight when a step is already due: the row is in Today
  // BECAUSE of that subtask, so making you click to find out which one would be a
  // poor joke. Initial state only, so collapsing it stays collapsed.
  const [expanded, setExpanded] = useState(
    () => task.status !== "done" && hasSubtaskDueToday(task, todayStr())
  );
  const [confirming, setConfirming] = useState(false);
  const done = task.status === "done";
  // Dim (but keep interactive) tasks due more than a month out, so the far
  // future recedes. Toggle in Settings › Appearance.
  const distant =
    dimDistantTasks && !done && !!task.due_date && task.due_date > monthAheadStr();
  const todayIsToday = todayStr();
  // Blocked = waiting on an open task OR a future blocked_until date. Shown as a
  // distinct, quiet signal (muted title + a blocked chip), deliberately NOT the
  // opacity fade used for distant tasks, so the two never read as the same thing.
  const blocked = isBlocked(task, todayIsToday);
  const subtasks = task.subtasks ?? [];
  const subDone = subtasks.filter((s) => s.done).length;
  const subOpen = subtasks.length - subDone;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { type: "task", task },
  });

  async function runComplete() {
    const res = await complete.mutateAsync({ id: task.id, done: !done });
    if (done) return; // was un-completing
    if (res?.recurred && res.due_date) {
      toast(`Recurring: next on ${res.due_date}`);
    } else {
      toast("Completed", () => complete.mutate({ id: task.id, done: false }));
    }
  }

  // Finishing a parent that still has open subtasks is nearly always a slip.
  // Ask, and let her tick them all off in the same gesture if that was the intent.
  async function onComplete() {
    if (!done && subOpen > 0) {
      setConfirming(true);
      return;
    }
    await runComplete();
  }

  async function onConfirmComplete(alsoCompleteSubtasks: boolean) {
    setConfirming(false);
    if (alsoCompleteSubtasks) await completeAll.mutateAsync(task.id);
    await runComplete();
  }

  // Area signal on the OUTER wrapper: a coloured left bar (the clear "belongs to
  // area X" cue) plus a gentle background wash. The bar is what carries the
  // signal, so the wash stays subtle and a tinted row never reads as *selected*
  // (selection/cursor are separate ring/bg layers on the inner row). The inner
  // row's hover/selection backgrounds are semi-transparent, so they compose over
  // this. Tasks with no area stay plain.
  const tint = tintArea ? areaTintBg(area?.color, 12) : undefined;
  const accent = tintArea && area ? areaColorVar(area.color) : undefined;
  return (
    <div
      className={cn(
        // A hairline border so each row reads as its own card against the page,
        // rather than text floating on the background.
        "rounded-md border border-border",
        isDragging && "opacity-40",
        // Dim the far future; hover restores full opacity so it never feels lost.
        distant && !isDragging && "opacity-45 transition-opacity hover:opacity-100"
      )}
      style={{
        ...(tint ? { backgroundColor: tint } : {}),
        ...(accent ? { boxShadow: `inset 3px 0 0 ${accent}` } : {}),
      }}
    >
      {/* The whole row is the drag surface (grab anywhere, including on touch via
          press-and-hold). A plain click still opens the task, because the sensor
          only starts a drag past a movement/hold threshold. Action controls below
          stop pointer-down from bubbling, so tapping them never starts a drag. */}
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        className={cn(
          "group flex touch-none items-start gap-2 rounded-md px-2.5 py-2.5 transition-colors",
          isDragging ? "cursor-grabbing" : "cursor-grab",
          selection?.cursor
            ? "bg-surface-2/70 ring-1 ring-primary/50"
            : selection?.selected
            ? "bg-primary/10"
            : "hover:bg-surface-2/50"
        )}
      >
        {/* Complete: leftmost and FIXED. It never shifts on hover, so ticking a
            task off is a single move to a stable target. */}
        <button
          aria-label="Complete"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onComplete}
          className={cn(
            "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-colors",
            done
              ? "border-primary bg-primary text-primary-foreground"
              : "hover:border-primary",
            // Optional tasks read as lower stakes: a dashed ring rather than a
            // solid one. Pairs with the dashed "optional" chip below.
            !done && !!task.optional && "border-dashed"
          )}
          style={done ? undefined : { borderColor: PRIORITY_VAR[task.priority] }}
        >
          {done && <CheckIcon className="h-2.5 w-2.5" />}
        </button>

        {/* Multi-select: a square checkbox in a RESERVED slot just right of the
            complete circle. It fades in on hover (or stays while a selection is
            active) using visibility, not display, so it never nudges the complete
            circle. Only rendered where selection is supported (list views). */}
        {selection && (
          <button
            aria-label={selection.selected ? "Deselect" : "Select"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              selection.onToggle();
            }}
            className={cn(
              "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition-[color,background-color]",
              selection.selected
                ? "border-primary bg-primary text-primary-foreground"
                : selection.active
                ? "border-input hover:border-primary"
                : "invisible group-hover:visible border-input hover:border-primary"
            )}
          >
            {selection.selected && <CheckIcon className="h-2.5 w-2.5" />}
          </button>
        )}

        {!done && <TodayToggle task={task} className="order-last mt-0.5" />}

        <button
          onClick={(e) => (selection ? selection.onRowClick(e) : onOpen(task))}
          className="flex-1 text-left"
        >
          <div
            className={cn(
              "text-sm leading-snug",
              done
                ? "text-subtle line-through"
                : blocked
                ? "text-muted" // quietened, but not opacity-faded like distant
                : "text-foreground",
              // A shade softer when optional. Loses to blocked/done above, which
              // are stronger statements about the same title.
              !blocked && optionalTitleTone(task)
            )}
          >
            {task.title}
          </div>
          <TaskMeta task={task} />
        </button>

        {/* Subtask disclosure. Sits outside the row-open button (a button cannot
            nest a button) and expands the checklist in place, so ticking a subtask
            never costs a trip through the task sheet. */}
        {subtasks.length > 0 && (
          <button
            aria-label={expanded ? "Hide subtasks" : "Show subtasks"}
            aria-expanded={expanded}
            title={`${subDone} of ${subtasks.length} subtasks done`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className={cn(
              "mt-0.5 inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[11px] transition-colors hover:bg-surface-2 hover:text-foreground",
              subOpen === 0 ? "text-primary" : "text-subtle"
            )}
          >
            <SubtaskIcon className="h-3 w-3" />
            {subDone}/{subtasks.length}
            {expanded ? (
              <ChevronDownIcon className="h-3 w-3" />
            ) : (
              <ChevronRightIcon className="h-3 w-3" />
            )}
          </button>
        )}
      </div>

      {expanded && subtasks.length > 0 && (
        <ul className="mb-1 ml-9 space-y-0.5 border-l border-border pl-3">
          {subtasks.map((s) => (
            <li key={s.id} className="flex items-center gap-2 py-0.5">
              <input
                type="checkbox"
                checked={s.done}
                aria-label={s.title}
                onChange={(e) =>
                  toggleSub.mutate({
                    taskId: task.id,
                    subId: s.id,
                    done: e.target.checked,
                  })
                }
                className="h-3.5 w-3.5 shrink-0 [accent-color:var(--primary)]"
              />
              <button
                onClick={() => onOpen(task)}
                title="Open the task to edit this subtask"
                className={cn(
                  "flex-1 text-left text-[13px] text-foreground hover:text-primary",
                  s.done && "text-subtle line-through"
                )}
              >
                {s.title}
              </button>
              {shouldPill(s.priority) && <PriorityPill priority={s.priority} />}
              {s.due_date && (
                <span className="shrink-0 text-[11px] text-primary" title={s.due_date}>
                  {dueLabel(s.due_date, todayIsToday)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmSubtasksDialog
        task={confirming ? task : null}
        onCancel={() => setConfirming(false)}
        onConfirm={onConfirmComplete}
      />
    </div>
  );
}
