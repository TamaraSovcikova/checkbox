import type { Task } from "../../shared/types";
import { useAreas, useProjects, useViewPrefs } from "../lib/queries";
import { recurrenceLabel } from "../../shared/recurrence";
import { areaColorVar, shouldPill } from "../lib/colors";
import { PriorityPill } from "./ui";
import { cn, todayStr, monthAheadStr } from "@/lib/utils";
import { inTodayView, subtasksDueBy, hasCheckpointDue } from "../lib/today";
import { isDormant } from "../lib/recurring";
import { openUnlocks } from "../../shared/flow";
import { dueLabel, isOverdue, parkedAgo } from "../lib/due";
import { useToggleToday } from "../lib/use-toggle-today";
import { isBlocked, blockedLabel, waitingChip } from "../lib/blocked";
import {
  RepeatIcon,
  BlockedIcon,
  TimerIcon,
  TodayIcon,
  DoingIcon,
  SnoozeIcon,
  SubtaskIcon,
  CheckpointIcon,
  FlowIcon,
  LinkIcon,
  ParkIcon,
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

// Where a task lives, resolved for DISPLAY. A task in a project takes that
// project's area even if its own area_id is empty: the project is in exactly one
// area, so the answer is never in doubt, and a row should not render as
// area-less just because a writer forgot to say so.
//
// enforceProjectArea + migration 0025 make the stored data agree, so this is the
// belt to that pair of braces: it keeps the UI honest for anything written by an
// older client, replayed from the offline queue, or sitting in a stale cache.
export function useTaskArea(task: Task) {
  const { data: areas = [] } = useAreas();
  const { data: projects = [] } = useProjects();
  const project = projects.find((p) => p.id === task.project_id);
  const areaId = task.area_id ?? project?.area_id ?? null;
  return { area: areas.find((a) => a.id === areaId), project };
}

// Tasks due more than a month out recede, so the far future does not compete with
// this week. Hover restores them, so nothing is ever lost behind it.
//
// Lived only in TaskRow, which is why a far-future task dimmed in a list and sat
// at full strength in the grid or board right beside it: the same "some styled,
// some not" drift that TaskMeta exists to end. Returns a class or false.
export function useDistantTone(task: Task) {
  const { dimDistantTasks } = useViewPrefs();
  return (
    dimDistantTasks &&
    task.status !== "done" &&
    !!task.due_date &&
    task.due_date > monthAheadStr() &&
    "opacity-45 transition-opacity hover:opacity-100"
  );
}

// A recurring task that is not asking for anything today recedes the same way.
// Her ask: "for tasks that are repeating, unless they are due or overdue they
// should be grayed out a bit until they are relevant". Backlog and project lists
// are where this bites, because those are the lists a routine sits in all week;
// the area page already parks dormant routines in its own tab.
//
// Unconditional, unlike the distant fade above: `dimDistantTasks` exists because
// a far-future due date is still a commitment you might want at full strength,
// while a routine between occurrences is asking for nothing by definition.
export const dormantTone = (task: Task, today: string) =>
  isDormant(task, today) && "opacity-50 transition-opacity hover:opacity-100";

// The clickable Today marker. Lit (solid, primary) when the task is in Today for
// ANY reason the view shows it - planned, due today/overdue, time-blocked today,
// carried in by a due subtask, or a due checkpoint - so it reads as a state, not
// just a button you pressed, and Remove is offered exactly when there is
// something to remove. On a row it reveals on hover when off; on a card there is
// no hover-reveal, since a card is the whole hit target.
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
  const on = inTodayView(task, todayStr());
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
        // Same trick as the complete circle: 20px icon, ~32px of tappable area
        // via a transparent ::before, so a thumb can hit it without the button
        // growing and reflowing the row.
        "relative z-10 before:absolute before:-inset-1.5 before:content-['']",
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
// `hideDueSubs` is for the step-led row in Today, which prints those subtasks as
// its own lines: the chip would be counting what is already on screen.
export function TaskMeta({
  task,
  hideDoing = false,
  hideDueSubs = false,
}: {
  task: Task;
  hideDoing?: boolean;
  hideDueSubs?: boolean;
}) {
  const { area, project } = useTaskArea(task);
  const done = task.status === "done";
  const doing = task.status === "doing";
  const today = todayStr();
  const blocked = isBlocked(task, today);
  const blockedText = blockedLabel(task, today);
  const waiting = waitingChip(task, today);
  const running = !!task.timer_started_at;

  // A task can be sitting in Today purely because one of its STEPS is due, while
  // its own due date is weeks out. Say so on the row: an entry you cannot explain
  // reads as a bug (the all-day box taught us that the expensive way). The count
  // is of open subtasks due today or already late.
  const dueSubs = done || hideDueSubs ? [] : subtasksDueBy(task, today);
  const lateSubs = dueSubs.filter((s) => s.due_date! < today);
  // Phrased so it is never a lie: all late reads "overdue", none late reads
  // "today", and a mix reads plain "due" rather than claiming either.
  const subLabel =
    lateSubs.length === 0
      ? `${dueSubs.length} subtask${dueSubs.length === 1 ? "" : "s"} today`
      : lateSubs.length === dueSubs.length
      ? `${dueSubs.length} subtask${dueSubs.length === 1 ? "" : "s"} overdue`
      : `${dueSubs.length} subtasks due`;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-subtle">
      {shouldPill(task.priority) && <PriorityPill priority={task.priority} />}
      {/* Coerce: D1 stores 0/1, and a bare `0 &&` would render a literal 0. */}
      {/* Set aside deliberately. It reaches almost no list, but where it does
          (the Parked view, a search result, a link chip) it has to say why it is
          not in the places you would expect it. */}
      {task.parked_at && !done && (
        <span
          className="inline-flex items-center gap-0.5 rounded border border-dashed border-input px-1 py-0.5 text-subtle"
          title={
            `Parked ${parkedAgo(task.parked_at, today)}` +
            (task.park_reason ? ` · ${task.park_reason}` : "")
          }
        >
          <ParkIcon className="h-3 w-3" />
          parked
        </span>
      )}
      {/* No deadline, ever, on purpose. Says so, because the useful thing to
          know when scanning a list is which entries are asking for nothing. */}
      {!!task.whenever && !done && (
        <span
          className="inline-flex items-center rounded border border-dashed border-input px-1 py-0.5 text-subtle"
          title="Whenever: no deadline, ever. Waiting in the Whenever list for a gap."
        >
          whenever
        </span>
      )}
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
      {/* The PLANNED day, when it is not today. Due and planned are two separate
          dates now (the deadline, and the day I mean to work on it), and a
          second date that is only visible inside the task sheet is not really
          visible. Today's plan is left to the Today marker on the row, which
          already says it and says it better; what this chip is for is "planned
          for Thursday" on a list you are scanning on Monday, and the carried
          plan you keep not getting to. Muted, never danger-toned: a plan you
          missed is a plan to move, not a broken promise. */}
      {!done && task.planned_date && task.planned_date !== today && (
        <span
          className="inline-flex items-center gap-0.5 text-muted"
          title={`Planned for ${task.planned_date}${
            task.planned_date < today ? " (carried forward)" : ""
          }`}
        >
          <TodayIcon className="h-3 w-3" />
          plan {dueLabel(task.planned_date, today)}
        </span>
      )}
      {dueSubs.length > 0 && (
        <span
          className={cn(
            "inline-flex items-center gap-0.5",
            lateSubs.length > 0 ? "text-danger" : "text-primary"
          )}
          // Names them, so you know which step is owed without opening the task.
          title={dueSubs.map((s) => `${s.title} (${s.due_date})`).join("\n")}
        >
          <SubtaskIcon className="h-3 w-3" />
          {subLabel}
        </span>
      )}
      {/* Finishing this task opens those: the flow, visible from any list.
          Doing the warm-up today is also what unblocks tomorrow's invites,
          and the row should say so without a trip to the Flow tab. */}
      {!done && openUnlocks(task).length > 0 && (
        <span
          className="inline-flex items-center gap-0.5 text-muted"
          title={`Unlocks: ${openUnlocks(task)
            .map((d) => d.title)
            .join(", ")}`}
        >
          <FlowIcon className="h-3 w-3" />
          unlocks {openUnlocks(task).length}
        </span>
      )}
      {/* Related tasks. A count, not a list: the point of a link is that the
          other task exists, and the titles are one hover (or one click into the
          sheet) away. Quiet by design, since a link never asks for anything. */}
      {(task.related ?? []).length > 0 && (
        <span
          className="inline-flex items-center gap-0.5 text-muted"
          title={`Related: ${(task.related ?? []).map((r) => r.title).join(", ")}`}
        >
          <LinkIcon className="h-3 w-3" />
          {(task.related ?? []).length} linked
        </span>
      )}
      {/* A checkpoint pulse is why this long-horizon task is in Today. Says so,
          like the subtask-due chip, so its presence is never a mystery. */}
      {!done && hasCheckpointDue(task, today) && (
        <span
          className="inline-flex items-center gap-0.5 text-primary"
          title={`Checkpoint due${task.due_date ? ` · task due ${task.due_date}` : ""}`}
        >
          <CheckpointIcon className="h-3 w-3" />
          check-in
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
      {/* Waiting on an external event. Quiet while the expected date holds;
          warning-toned "chase" once it has passed, because then the useful
          action is chasing, not waiting. */}
      {waiting && (
        <span
          className={cn(
            "inline-flex items-center gap-0.5 rounded px-1 py-0.5",
            waiting.kind === "chase"
              ? "bg-warning/15 text-warning"
              : "bg-surface-2 text-subtle"
          )}
          title={
            task.waiting_expected
              ? `Expected by ${task.waiting_expected}`
              : "Waiting on an external event"
          }
        >
          <SnoozeIcon className="h-3 w-3" />
          {waiting.label}
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
