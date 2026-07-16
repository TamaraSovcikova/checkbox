import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { Task } from "../../shared/types";
import {
  useAreas,
  useCompleteAllSubtasks,
  useCompleteTask,
  useProjects,
  useToggleSubtask,
  useUpdateTask,
  useViewPrefs,
} from "../lib/queries";
import { useToast } from "../lib/toast";
import { recurrenceLabel } from "../../shared/recurrence";
import { PRIORITY_VAR, areaColorVar, areaTintBg, shouldPill } from "../lib/colors";
import { PriorityPill } from "./ui";
import { cn, todayStr, monthAheadStr } from "@/lib/utils";
import { inToday, leaveTodayBody, undoLeaveTodayBody } from "../lib/today";
import { isBlocked, blockedLabel } from "../lib/blocked";
import {
  CheckIcon,
  RepeatIcon,
  BlockedIcon,
  TimerIcon,
  TodayIcon,
  SubtaskIcon,
  DoingIcon,
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
  const update = useUpdateTask();
  const toggleSub = useToggleSubtask();
  const completeAll = useCompleteAllSubtasks();
  const { dimDistantTasks } = useViewPrefs();
  const { data: areas = [] } = useAreas();
  const { data: projects = [] } = useProjects();
  const { toast } = useToast();
  // Where the task lives, for an at-a-glance colour + a discreet project label
  // (most useful in mixed views like Today). Cached queries, so cheap per row.
  const area = areas.find((a) => a.id === task.area_id);
  const project = projects.find((p) => p.id === task.project_id);
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const done = task.status === "done";
  const doing = task.status === "doing";
  // Dim (but keep interactive) tasks due more than a month out, so the far
  // future recedes. Toggle in Settings › Appearance.
  const distant =
    dimDistantTasks && !done && !!task.due_date && task.due_date > monthAheadStr();
  const todayIsToday = todayStr();
  // "In Today" means the task surfaces in the Today view for ANY reason (planned,
  // due today/overdue, or time-blocked today), not just an explicit plan. So the
  // toggle's Remove branch can actually clear it out.
  const isInToday = inToday(task, todayIsToday);
  // Blocked = waiting on an open task OR a future blocked_until date. Shown as a
  // distinct, quiet signal (muted title + a blocked chip), deliberately NOT the
  // opacity fade used for distant tasks, so the two never read as the same thing.
  const blocked = isBlocked(task, todayIsToday);
  const blockedText = blockedLabel(task, todayIsToday);
  const running = !!task.timer_started_at;
  const subtasks = task.subtasks ?? [];
  const subDone = subtasks.filter((s) => s.done).length;
  const subOpen = subtasks.length - subDone;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { type: "task", task },
  });

  // Toggle Today. Add just marks intent (planned_date) without touching the
  // deadline. Remove clears every trigger so the task truly leaves Today and
  // falls back to its area/project (or Backlog if it has none); undoable.
  function onToggleToday() {
    if (isInToday) {
      const body = leaveTodayBody(task, todayIsToday);
      update.mutate({ id: task.id, body });
      const prev = undoLeaveTodayBody(task, body);
      toast("Removed from Today", () => update.mutate({ id: task.id, body: prev }));
    } else {
      update.mutate({ id: task.id, body: { planned_date: todayIsToday } });
      toast("Added to Today");
    }
  }

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
        "rounded-md",
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

        {!done && (
          <button
            aria-label={isInToday ? "Remove from Today" : "Add to Today"}
            title={isInToday ? "Remove from Today" : "Add to Today"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleToday();
            }}
            className={cn(
              "order-last mt-0.5 h-5 w-5 shrink-0 place-items-center rounded transition-colors",
              isInToday
                ? "grid text-primary hover:text-primary/80"
                : "hidden text-subtle hover:text-foreground group-hover:grid"
            )}
          >
            <TodayIcon className="h-3.5 w-3.5" />
          </button>
        )}

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
                : "text-foreground"
            )}
          >
            {task.title}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-subtle">
            {shouldPill(task.priority) && <PriorityPill priority={task.priority} />}
            {/* Coerce: D1 stores 0/1, and a bare `0 &&` would render a literal 0. */}
            {!!task.optional && !done && (
              <span
                className="inline-flex items-center rounded border border-dashed border-input px-1 py-0.5 text-subtle"
                title="Optional: a nice-to-have, not a commitment"
              >
                optional
              </span>
            )}
            {(area || project) && (
              <span
                className="inline-flex items-center gap-1"
                title={[area?.name, project?.name].filter(Boolean).join(" › ")}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: areaColorVar(area?.color) }}
                />
                {project && <span className="text-muted">{project.name}</span>}
              </span>
            )}
            {doing && (
              <span
                className="inline-flex items-center gap-0.5 text-primary"
                title="In progress"
              >
                <DoingIcon className="h-3 w-3" />
                doing
              </span>
            )}
            {task.due_date && (
              <span className="text-primary">
                {task.due_date}
                {task.due_time ? ` ${task.due_time}` : ""}
              </span>
            )}
            {blocked && (
              <span
                className="inline-flex items-center gap-0.5 rounded bg-surface-2 px-1 py-0.5 text-subtle"
                title={`Blocked ${blockedText ?? ""}`.trim()}
              >
                <BlockedIcon className="h-3 w-3" />
                {blockedText ? `blocked ${blockedText}` : "blocked"}
              </span>
            )}
            {running && (
              <span className="inline-flex items-center gap-0.5 text-danger" title="Timer running">
                <TimerIcon className="h-3 w-3" />
                tracking
              </span>
            )}
            {task.recurrence && (
              <span className="inline-flex items-center gap-0.5 text-muted">
                <RepeatIcon className="h-3 w-3" />
                {recurrenceLabel(task.recurrence)}
              </span>
            )}
            {task.time_spent_min > 0 ? (
              <span title="Time spent / estimate">
                {task.time_spent_min}m
                {task.time_estimate_min ? `/${task.time_estimate_min}m` : ""}
              </span>
            ) : (
              task.time_estimate_min && <span>{task.time_estimate_min}m</span>
            )}
            {(task.labels ?? []).map((l) => (
              <span key={l.id} className="text-muted">
                @{l.name}
              </span>
            ))}
          </div>
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
                <span className="shrink-0 text-[11px] text-primary">{s.due_date}</span>
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
