import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { Task } from "../../shared/types";
import { useCompleteTask, useToggleSubtask, useUpdateTask } from "../lib/queries";
import { useCompleteGuard } from "../lib/use-complete-guard";
import { useToast } from "../lib/toast";
import { PRIORITY_VAR, areaColorVar, areaTintBg, shouldPill } from "../lib/colors";
import { PriorityPill } from "./ui";
import { cn, todayStr } from "@/lib/utils";
import { isBlocked } from "../lib/blocked";
import { dueLabel } from "../lib/due";
import {
  hasSubtaskDueToday,
  hasCheckpointDue,
  isSubtaskLed,
  subtasksDueToday,
} from "../lib/today";
import { advanceCheckpointBody } from "../../shared/checkpoint";
import {
  TaskMeta,
  TodayToggle,
  optionalTitleTone,
  useTaskArea,
  useDistantTone,
  dormantTone,
} from "./TaskMeta";
import {
  CheckIcon,
  SubtaskIcon,
  CheckpointIcon,
  ChevronRightIcon,
  ChevronDownIcon,
} from "../lib/icons";
import { useTaskHover } from "./TaskHoverCard";
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
  const { guard, dialog } = useCompleteGuard();
  const update = useUpdateTask();
  const { toast } = useToast();
  // Where the task lives, for the wrapper's tint + accent bar. Resolved through
  // the project when the task carries no area of its own, so a row can never
  // render as area-less beside an identical tinted one.
  const { area } = useTaskArea(task);
  // In Today ONLY because a step is due: the STEP is the work, so the row is
  // drawn as that step with the parent above it as context. Her words: "when a
  // subtask is due I don't want the main task card to show up on my today board
  // but the subtask itself... it has to be clear that it's part of the main
  // task, but primarily you should see the subtask".
  const subtaskLed = isSubtaskLed(task, todayStr());
  // The steps that put the task here. They are rendered as the row's main lines,
  // so they come OUT of the collapsed checklist below (which would otherwise
  // print each of them twice).
  const leadSteps = subtaskLed ? subtasksDueToday(task, todayStr()) : [];
  // Open the checklist on sight when a step is already due and the row is NOT
  // step-led (a task in Today on its own account that also has a step due):
  // making you click to find out which one would be a poor joke. Initial state
  // only, so collapsing it stays collapsed.
  const [expanded, setExpanded] = useState(
    () =>
      task.status !== "done" &&
      hasSubtaskDueToday(task, todayStr()) &&
      !isSubtaskLed(task, todayStr())
  );
  const done = task.status === "done";
  // Dim (but keep interactive) tasks due more than a month out, so the far future
  // recedes. Toggle in Settings › Appearance. Shared, so a grid or board card
  // fades in step with the row rather than staying at full strength.
  const distant = useDistantTone(task);
  const todayIsToday = todayStr();
  // A routine between occurrences recedes until it is due. Same mechanism as the
  // far-future fade, and they compose harmlessly (a dormant routine is dim
  // either way).
  const dormant = dormantTone(task, todayIsToday);
  // Blocked = waiting on an open task OR a future blocked_until date. Shown as a
  // distinct, quiet signal (muted title + a blocked chip), deliberately NOT the
  // opacity fade used for distant tasks, so the two never read as the same thing.
  const blocked = isBlocked(task, todayIsToday);
  const checkpointDue = !done && hasCheckpointDue(task, todayIsToday);
  const subtasks = task.subtasks ?? [];
  const subDone = subtasks.filter((s) => s.done).length;
  const subOpen = subtasks.length - subDone;
  // What the disclosure holds: everything except the steps already printed as
  // the row's main lines. The n/n counter still counts ALL of them, because it
  // reports the task's progress and not the size of this list.
  const checklist = subtasks.filter((s) => !leadSteps.some((l) => l.id === s.id));
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { type: "task", task },
  });
  // Rest the mouse on a row to read its notes and blockers without opening the
  // sheet. Suppressed mid-drag.
  const { hoverProps, card } = useTaskHover(task, isDragging);

  // Mark on track: advance the checkpoint to its next pulse, so the task drops
  // out of Today until then. Undoable to the exact prior pulse date.
  function onCheckpointOnTrack() {
    const body = advanceCheckpointBody(
      todayIsToday,
      task.checkpoint_days,
      task.checkpoint_next,
      task.due_date
    );
    const prev = task.checkpoint_next;
    update.mutate({ id: task.id, body });
    toast(
      body.checkpoint_next ? `On track · next ${body.checkpoint_next}` : "On track",
      () => update.mutate({ id: task.id, body: { checkpoint_next: prev } })
    );
  }

  async function runComplete() {
    await complete.mutateAsync({ id: task.id, done: !done });
    if (done) return; // was un-completing
    // A recurring task stays crossed out for the rest of the day and the
    // morning sweep wakes it as the next occurrence: say so, so its calm is
    // never mistaken for the repeat being broken.
    toast(
      task.recurrence ? "Done for today · repeats tomorrow morning" : "Completed",
      () => complete.mutate({ id: task.id, done: false })
    );
  }

  // Finishing a parent that still has open subtasks is nearly always a slip.
  // The question, and the tick-them-all shortcut, live in useCompleteGuard so
  // every other way of finishing a task asks it too.
  function onComplete() {
    guard(task, runComplete);
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
      {...hoverProps}
      className={cn(
        // A hairline border so each row reads as its own card against the page,
        // rather than text floating on the background.
        "rounded-md border border-border",
        isDragging && "opacity-40",
        // Dim the far future; hover restores full opacity so it never feels lost.
        // Suppressed mid-drag, where opacity-40 already applies.
        !isDragging && distant,
        !isDragging && dormant
      )}
      style={{
        ...(tint ? { backgroundColor: tint } : {}),
        ...(accent ? { boxShadow: `inset 3px 0 0 ${accent}` } : {}),
      }}
    >
      {card}
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
            task off is a single move to a stable target.

            Absent on a step-led row: there the work is the step, and a circle
            that completed the whole parent sitting beside a step's title is a
            trap. The parent is still completable from its sheet. */}
        {!subtaskLed && (
        <button
          aria-label="Complete"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onComplete}
          className={cn(
            "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-colors",
            // The circle stays 16px, but the TAPPABLE area extends past it via a
            // transparent ::before. This is the most-used control in the app and
            // 16px is a poor target for a thumb: 12px of slack below md (40px
            // total, thumb-sized), 6px above it (28px, mouse-sized). Purely a
            // hit area: nothing moves.
            "relative z-10 before:absolute before:content-[''] max-md:before:-inset-3 md:before:-inset-1.5",
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
        )}

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

        {/* One-tap "on track" when a checkpoint pulse is due: advances to the
            next pulse and drops the task out of Today until then. The whole point
            of a checkpoint is the quick glance-and-confirm, so it lives on the
            row, not only in the sheet. */}
        {!done && checkpointDue && (
          <button
            type="button"
            aria-label="Mark on track"
            title="On track — next check-in later"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onCheckpointOnTrack();
            }}
            className="order-last mt-0.5 inline-flex shrink-0 items-center gap-0.5 rounded border border-primary/40 px-1.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
          >
            <CheckpointIcon className="h-3 w-3" />
            On track
          </button>
        )}

        {!done && <TodayToggle task={task} className="order-last mt-0.5" />}

        {subtaskLed ? (
          /* Step-led row: the parent is a breadcrumb over the step(s) that are
             actually due. Same card, inverted emphasis. The parent line and each
             step title open the task sheet (which is where a step is edited);
             only the step's own circle ticks it off. */
          <div className="min-w-0 flex-1">
            <button
              onClick={(e) => (selection ? selection.onRowClick(e) : onOpen(task))}
              className="flex w-full items-center gap-1 text-left text-[11px] leading-tight text-subtle hover:text-muted"
              title={`Part of: ${task.title}`}
            >
              <SubtaskIcon className="h-3 w-3 shrink-0" />
              <span className="truncate">{task.title}</span>
            </button>
            <ul className="mt-0.5 space-y-1">
              {leadSteps.map((s) => (
                <li key={s.id} className="flex items-start gap-2">
                  <button
                    aria-label={`Complete ${s.title}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSub.mutate({ taskId: task.id, subId: s.id, done: true });
                    }}
                    className={cn(
                      "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-colors hover:border-primary",
                      // Same generous hit area as the task circle it stands in for.
                      "relative z-10 before:absolute before:content-[''] max-md:before:-inset-3 md:before:-inset-1.5"
                    )}
                    style={{
                      borderColor: PRIORITY_VAR[s.priority ?? task.priority],
                    }}
                  />
                  <button
                    onClick={(e) => (selection ? selection.onRowClick(e) : onOpen(task))}
                    className="min-w-0 flex-1 text-left text-sm leading-snug text-foreground"
                  >
                    {s.title}
                  </button>
                  {shouldPill(s.priority) && <PriorityPill priority={s.priority} />}
                </li>
              ))}
            </ul>
            {/* The parent's context (project, area, its own due date), minus the
                "N subtasks today" chip: the row IS those subtasks now. */}
            <TaskMeta task={task} hideDueSubs />
          </div>
        ) : (
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
                ? "text-muted"
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
        )}

        {/* Subtask disclosure. Sits outside the row-open button (a button cannot
            nest a button) and expands the checklist in place, so ticking a subtask
            never costs a trip through the task sheet. On a step-led row it holds
            the OTHER steps, and disappears when there are none. */}
        {checklist.length > 0 && (
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

      {expanded && checklist.length > 0 && (
        <ul className="mb-1 ml-9 space-y-0.5 border-l border-border pl-3">
          {checklist.map((s) => (
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
                  s.done && "text-subtle line-through",
                  // A step due today that is NOT leading this row (the task is
                  // in Today on its own account too) still reads at full weight.
                  !s.done && s.due_date === todayIsToday && "font-medium"
                )}
              >
                {s.title}
              </button>
              {!s.done && s.due_date === todayIsToday && (
                <span className="shrink-0 rounded border border-primary/40 px-1 text-[10px] font-semibold text-primary">
                  due today
                </span>
              )}
              {shouldPill(s.priority) && <PriorityPill priority={s.priority} />}
              {s.due_date && s.due_date !== todayIsToday && (
                <span className="shrink-0 text-[11px] text-primary" title={s.due_date}>
                  {dueLabel(s.due_date, todayIsToday)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {dialog}
    </div>
  );
}
