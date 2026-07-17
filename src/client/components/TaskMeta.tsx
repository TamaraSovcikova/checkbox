import type { Task } from "../../shared/types";
import { useAreas, useProjects } from "../lib/queries";
import { recurrenceLabel } from "../../shared/recurrence";
import { areaColorVar, shouldPill } from "../lib/colors";
import { PriorityPill } from "./ui";
import { cn, todayStr } from "@/lib/utils";
import { inToday } from "../lib/today";
import { dueLabel, isOverdue } from "../lib/due";
import { useToggleToday } from "../lib/use-toggle-today";
import { isBlocked, blockedLabel } from "../lib/blocked";
import {
  RepeatIcon,
  BlockedIcon,
  TimerIcon,
  TodayIcon,
  DoingIcon,
} from "../lib/icons";

// ── The one description of what a task looks like ────────────────────────────
//
// There were three renderers (TaskRow, the board's BoardCard, the grid's
// TaskCard) and each hand-rolled its own chip strip. The two card ones only ever
// grew priority + area + due date + labels, so `optional` and the Today marker
// simply did not exist outside list views: on an area or project page, which
// default to board/grid, the styling looked like it had "gone away". It had
// never been there. Both card renderers now call this, so a new signal is added
// once and shows up everywhere.

// The clickable Today marker. Lit (solid, primary) when the task is in Today for
// ANY reason - planned, due today/overdue, or time-blocked today - so it reads as
// a state, not just a button you pressed. On a row it reveals on hover when off;
// on a card there is no hover-reveal, since a card is the whole hit target.
export function TodayToggle({
  task,
  alwaysVisible = false,
  className,
}: {
  task: Task;
  alwaysVisible?: boolean;
  className?: string;
}) {
  const toggleToday = useToggleToday();
  const on = inToday(task, todayStr());
  return (
    <button
      aria-label={on ? "Remove from Today" : "Add to Today"}
      title={on ? "Remove from Today" : "Add to Today"}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        toggleToday(task);
      }}
      className={cn(
        "h-5 w-5 shrink-0 place-items-center rounded transition-colors",
        on
          ? "grid text-primary hover:text-primary/80"
          : alwaysVisible
          ? "grid text-subtle hover:text-foreground"
          : "hidden text-subtle hover:text-foreground group-hover:grid",
        className
      )}
    >
      <TodayIcon className="h-3.5 w-3.5" />
    </button>
  );
}

// The chip strip under a task's title. `hideDoing` is for the board, where the
// column heading already says "Doing" and the chip would just repeat it.
export function TaskMeta({
  task,
  hideDoing = false,
}: {
  task: Task;
  hideDoing?: boolean;
}) {
  const { data: areas = [] } = useAreas();
  const { data: projects = [] } = useProjects();
  const area = areas.find((a) => a.id === task.area_id);
  const project = projects.find((p) => p.id === task.project_id);
  const done = task.status === "done";
  const doing = task.status === "doing";
  const today = todayStr();
  const blocked = isBlocked(task, today);
  const blockedText = blockedLabel(task, today);
  const running = !!task.timer_started_at;

  return (
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
      {doing && !hideDoing && (
        <span className="inline-flex items-center gap-0.5 text-primary" title="In progress">
          <DoingIcon className="h-3 w-3" />
          doing
        </span>
      )}
      {task.due_date && (
        <span
          className={isOverdue(task.due_date, today) && !done ? "text-danger" : "text-primary"}
          // The exact date stays one hover away: "Fri" is faster to scan, but
          // when you do need the number you should not have to open the task.
          title={task.due_date + (task.due_time ? ` ${task.due_time}` : "")}
        >
          {dueLabel(task.due_date, today)}
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
  );
}

// An optional task is a nice-to-have, not a commitment. On a row that reads as a
// dashed complete-circle; a card has no circle, so the CARD's own border goes
// dashed. Same visual language (dashed = optional), applied to whatever edge the
// surface actually has.
export const optionalCardBorder = (task: Task) =>
  !!task.optional && task.status !== "done" && "border-dashed";

// ...and the title sits a shade softer than a committed one, so a list reads at a
// glance without having to find the dashes. Deliberately its own step on the
// scale: `distant` fades the whole row to opacity-45 and `blocked` drops the
// title to text-muted, so optional lands between full strength and those two and
// never reads as either. Dial the number, not the mechanism, if it wants more.
export const optionalTitleTone = (task: Task) =>
  !!task.optional && task.status !== "done" && "text-foreground/70";
