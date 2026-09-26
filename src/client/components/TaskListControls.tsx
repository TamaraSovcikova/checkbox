import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { format } from "date-fns";
import type { Task } from "../../shared/types";
import { parseDatePhrase } from "../lib/nlp";
import { cn } from "@/lib/utils";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { api } from "../lib/api";
import { useTaskInvalidate, useAreas, useProjects } from "../lib/queries";
import { useToast } from "../lib/toast";
import { useCompleteGuard } from "../lib/use-complete-guard";
import { completedMessage } from "../lib/completion";
import {
  CheckIcon,
  TrashIcon,
  RescheduleIcon,
  CloseIcon,
  MoreIcon,
  CalendarIcon,
} from "../lib/icons";

// Lazy: react-day-picker only loads when the date picker is actually opened.
const Calendar = lazy(() =>
  import("./ui/calendar").then((m) => ({ default: m.Calendar }))
);
import { Button } from "./ui";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";

// Today (Europe/Brussels) as YYYY-MM-DD, matching the server's day boundary.
function todayStr() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function addDaysStr(date: string, n: number) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  const p = (x: number) => String(x).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

export interface RowSelection {
  selected: boolean;
  cursor: boolean;
  active: boolean; // any selection exists → checkboxes visible
  onToggle: () => void;
  onRowClick: (e: React.MouseEvent) => void;
}

export interface TaskControls {
  selectedIds: Set<string>;
  count: number;
  // The unfinished-subtasks question for the keyboard shortcut. The list body
  // renders it; a keystroke has no row to hang a dialog on.
  dialog: ReactNode;
  rowFor: (task: Task, index: number) => RowSelection;
  clear: () => void;
  // bulk operations
  completeSelected: () => void;
  deleteSelected: () => void;
  // Sets a DEADLINE on the whole selection.
  scheduleSelected: (date: string | null) => void;
  // Sets the PLANNED day, which is what the bar's Today/Tomorrow buttons do.
  planSelected: (date: string) => void;
  // "Set these fields on everything selected", with a per-task undo snapshot.
  // Everything below is expressible through it; the named ones survive because
  // they do more than write columns (backlog also clears the project).
  bulkUpdate: (
    patch: Record<string, unknown>,
    said: (n: number) => string
  ) => void;
  moveSelectedToBacklog: () => void;
  snoozeSelected: (until: string) => void;
}

// Selection + keyboard navigation over an ordered task list. j/k move a cursor,
// x toggles selection, c completes, e/Enter opens. Shift/Cmd-click range- or
// toggle-selects. Bulk ops route through the API with undo toasts.
export function useTaskSelection(
  tasks: Task[],
  onOpen: (t: Task) => void,
  enabled = true
): TaskControls {
  const invalidate = useTaskInvalidate();
  const { toast } = useToast();
  const { guard, guardMany, dialog } = useCompleteGuard();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // -1 = no keyboard cursor yet, so nothing looks "selected" on load. The first
  // j/k/arrow moves it onto a row; a plain mouse click never sets it.
  const [cursor, setCursor] = useState(-1);
  const lastClicked = useRef<number>(-1);

  // Keep the cursor and selection valid as the list changes. Preserve -1 (no
  // cursor); only clamp a real cursor into range.
  useEffect(() => {
    setCursor((c) => (c < 0 ? -1 : Math.min(c, Math.max(0, tasks.length - 1))));
    setSelectedIds((sel) => {
      const ids = new Set(tasks.map((t) => t.id));
      const next = new Set([...sel].filter((id) => ids.has(id)));
      return next.size === sel.size ? sel : next;
    });
  }, [tasks]);

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  const toggle = useCallback((id: string) => {
    setSelectedIds((sel) => {
      const next = new Set(sel);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectRange = useCallback(
    (to: number) => {
      const from = lastClicked.current < 0 ? to : lastClicked.current;
      const [lo, hi] = from < to ? [from, to] : [to, from];
      setSelectedIds((sel) => {
        const next = new Set(sel);
        for (let i = lo; i <= hi; i++) if (tasks[i]) next.add(tasks[i].id);
        return next;
      });
    },
    [tasks]
  );

  // ── bulk ops ──────────────────────────────────────────────────────────────
  const selectedTasks = useCallback(
    () => tasks.filter((t) => selectedIds.has(t.id)),
    [tasks, selectedIds]
  );

  const completeSelected = useCallback(() => {
    const items = selectedTasks();
    if (!items.length) return;
    // One question for the whole selection, naming the tasks that would leave
    // steps behind. A selection is deliberate, but "which of these twenty had
    // something unfinished" is exactly what you cannot see from the bar.
    guardMany(items, () => {
      Promise.all(items.map((t) => api.completeTask(t.id, true))).then(invalidate);
      clear();
      toast(`${items.length} completed`, () => {
        Promise.all(items.map((t) => api.completeTask(t.id, false))).then(invalidate);
      });
    });
  }, [selectedTasks, invalidate, clear, toast, guardMany]);

  const deleteSelected = useCallback(() => {
    const items = selectedTasks();
    if (!items.length) return;
    Promise.all(items.map((t) => api.deleteTask(t.id))).then(invalidate);
    clear();
    toast(`${items.length} deleted`, () => {
      Promise.all(items.map((t) => api.restoreTask(t))).then(invalidate);
    });
  }, [selectedTasks, invalidate, clear, toast]);

  // Deadlines in bulk. Kept, but no longer what the bar's Today/Tomorrow
  // buttons do: see planSelected.
  const scheduleSelected = useCallback(
    (date: string | null) => {
      const items = selectedTasks();
      if (!items.length) return;
      const prev = items.map((t) => ({ id: t.id, due: t.due_date, time: t.due_time }));
      Promise.all(items.map((t) => api.rescheduleTask(t.id, date))).then(invalidate);
      clear();
      toast(date ? `${items.length} rescheduled` : `${items.length} unscheduled`, () => {
        Promise.all(prev.map((p) => api.rescheduleTask(p.id, p.due, p.time))).then(
          invalidate
        );
      });
    },
    [selectedTasks, invalidate, clear, toast]
  );

  const snoozeSelected = useCallback(
    (until: string) => {
      const items = selectedTasks();
      if (!items.length) return;
      const prev = items.map((t) => ({ id: t.id, until: t.snoozed_until }));
      Promise.all(items.map((t) => api.snoozeTask(t.id, until))).then(invalidate);
      clear();
      toast(`${items.length} snoozed`, () => {
        Promise.all(prev.map((p) => api.snoozeTask(p.id, p.until))).then(invalidate);
      });
    },
    [selectedTasks, invalidate, clear, toast]
  );

  // Every "set a field on all of them" action, in one place.
  //
  // There were five near-identical callbacks differing only in which columns
  // they wrote and how they phrased the toast, which is why the list of bulk
  // actions stopped growing: each new one cost a copy of the same twelve lines.
  // This snapshots exactly the keys it is about to change, per task, so the undo
  // restores what each one had rather than a single shared value.
  const bulkUpdate = useCallback(
    (patch: Record<string, unknown>, said: (n: number) => string) => {
      const items = selectedTasks();
      if (!items.length) return;
      const keys = Object.keys(patch);
      const prev = items.map((t) => {
        const before: Record<string, unknown> = {};
        // ?? null, not the raw value: JSON.stringify drops undefined, and a
        // field missing from the undo body is a field the undo silently skips.
        for (const k of keys) before[k] = (t as unknown as Record<string, unknown>)[k] ?? null;
        return { id: t.id, before };
      });
      Promise.all(items.map((t) => api.updateTask(t.id, patch))).then(invalidate);
      clear();
      toast(said(items.length), () => {
        Promise.all(prev.map((p) => api.updateTask(p.id, p.before))).then(invalidate);
      });
    },
    [selectedTasks, invalidate, clear, toast]
  );

  // "Today"/"Tomorrow" in the bar PLAN the selection; they used to set a due
  // date. That was right before planned_date was a field you could set, and
  // wrong after: every other Today control in the app writes planned_date, and a
  // bulk button that quietly hands twenty tasks a DEADLINE instead is the kind
  // of disagreement you only notice a week later. Deadlines in bulk are still
  // available through scheduleSelected, they are just not what this button is.
  const planSelected = useCallback(
    (date: string) =>
      bulkUpdate({ planned_date: date }, (n) => `${n} planned`),
    [bulkUpdate]
  );

  const moveSelectedToBacklog = useCallback(() => {
    const items = selectedTasks();
    if (!items.length) return;
    const prev = items.map((t) => ({
      id: t.id,
      area_id: t.area_id,
      project_id: t.project_id,
    }));
    Promise.all(
      items.map((t) => api.updateTask(t.id, { area_id: null, project_id: null }))
    ).then(invalidate);
    clear();
    toast(`${items.length} moved to Backlog`, () => {
      Promise.all(
        prev.map((p) =>
          api.updateTask(p.id, { area_id: p.area_id, project_id: p.project_id })
        )
      ).then(invalidate);
    });
  }, [selectedTasks, invalidate, clear, toast]);

  // ── keyboard ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      // Don't fight an open dialog/sheet (Radix sets aria-hidden on the app root).
      if (document.querySelector("[role=dialog]")) return;
      if (!tasks.length) return;

      const cur = tasks[Math.min(cursor, tasks.length - 1)];
      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setCursor((c) => Math.min(c + 1, tasks.length - 1));
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setCursor((c) => Math.max(c - 1, 0));
          break;
        case "x":
          e.preventDefault();
          if (cur) toggle(cur.id);
          break;
        case "c":
          e.preventDefault();
          // Same question a click on the circle asks: one keystroke should not
          // be the way to silently finish a task with steps still open.
          if (cur)
            guard(cur, () =>
              api.completeTask(cur.id, true).then((res) => {
                invalidate();
                toast(completedMessage(cur, res), () => {
                  api.completeTask(cur.id, false).then(invalidate);
                });
              })
            );
          break;
        case "e":
        case "Enter":
          e.preventDefault();
          if (cur) onOpen(cur);
          break;
        case "Escape":
          if (selectedIds.size) {
            e.preventDefault();
            clear();
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    enabled,
    tasks,
    cursor,
    toggle,
    onOpen,
    selectedIds,
    clear,
    invalidate,
    toast,
    guard,
  ]);

  const rowFor = useCallback(
    (task: Task, index: number): RowSelection => ({
      selected: selectedIds.has(task.id),
      cursor: index === cursor,
      active: selectedIds.size > 0,
      onToggle: () => {
        lastClicked.current = index;
        toggle(task.id);
      },
      onRowClick: (e: React.MouseEvent) => {
        if (e.shiftKey) {
          setCursor(index);
          e.preventDefault();
          selectRange(index);
        } else if (e.metaKey || e.ctrlKey) {
          setCursor(index);
          e.preventDefault();
          lastClicked.current = index;
          toggle(task.id);
        } else if (selectedIds.size > 0) {
          // In selection mode a plain click extends the selection instead of
          // opening. Matches Gmail/Todoist multi-select ergonomics.
          setCursor(index);
          e.preventDefault();
          lastClicked.current = index;
          toggle(task.id);
        } else {
          // Plain click just opens; it must not leave a cursor highlight behind.
          onOpen(task);
        }
      },
    }),
    [selectedIds, cursor, toggle, selectRange, onOpen]
  );

  return {
    selectedIds,
    count: selectedIds.size,
    // Rendered by the list body: the unfinished-subtasks question for the
    // keyboard shortcut, which has no row of its own to hang a dialog on.
    dialog,
    rowFor,
    clear,
    completeSelected,
    bulkUpdate,
    planSelected,
    deleteSelected,
    scheduleSelected,
    moveSelectedToBacklog,
    snoozeSelected,
  };
}

// Floating action bar shown while a selection is active.
export function BulkActionBar({ controls }: { controls: TaskControls }) {
  if (controls.count === 0) return null;
  const today = todayStr();
  return (
    <div className="pointer-events-auto fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-surface-2 px-2 py-2 shadow-lg">
      <span className="whitespace-nowrap px-2 text-sm font-medium text-foreground">
        {controls.count} selected
      </span>
      <div className="mx-1 h-5 w-px bg-border" />
      <BarBtn onClick={controls.completeSelected} icon={<CheckIcon className="h-4 w-4" />}>
        Complete
      </BarBtn>
      <BarBtn
        onClick={() => controls.planSelected(today)}
        icon={<RescheduleIcon className="h-4 w-4" />}
        title="Plan these for today. Does not set a deadline."
      >
        Today
      </BarBtn>
      <BarBtn
        onClick={() => controls.planSelected(addDaysStr(today, 1))}
        title="Plan these for tomorrow. Does not set a deadline."
      >
        Tomorrow
      </BarBtn>
      <BulkDateButton controls={controls} today={today} />
      {/* Everything else. A bar wide enough for every bulk action would not fit
          a phone, and the ones below are each worth having but none is worth a
          permanent slot. */}
      <BulkMore controls={controls} today={today} />
      <BarBtn
        onClick={controls.deleteSelected}
        icon={<TrashIcon className="h-4 w-4" />}
        danger
      >
        Delete
      </BarBtn>
      <div className="mx-1 h-5 w-px bg-border" />
      <button
        onClick={controls.clear}
        aria-label="Clear selection"
        className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface hover:text-foreground"
      >
        <CloseIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

// Any date, for the whole selection (issue #1).
//
// The bar could only say today or tomorrow, and a deadline only today: moving a
// dozen tasks to "the 3rd" meant opening a dozen sheets. One button, three
// modes, because the three dates mean different things and the bar has room for
// one control, not three. It took the Snooze button's slot; snoozing to
// tomorrow is still two clicks away, as a preset inside.
type BulkDateMode = "plan" | "deadline" | "snooze";

const MODE_LABEL: Record<BulkDateMode, string> = {
  plan: "Plan",
  deadline: "Deadline",
  snooze: "Snooze",
};

const MODE_HINT: Record<BulkDateMode, string> = {
  plan: "The day to work on them. Shows them in Today from then.",
  deadline: "When they are owed.",
  snooze: "Hide them until this day.",
};

export function BulkDateButton({
  controls,
  today,
}: {
  controls: TaskControls;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<BulkDateMode>("plan");
  const [phrase, setPhrase] = useState("");
  const [unparsed, setUnparsed] = useState(false);

  function apply(date: string | null) {
    if (mode === "plan") {
      if (date) controls.planSelected(date);
      else controls.bulkUpdate({ planned_date: null }, (n) => `${n} unplanned`);
    } else if (mode === "deadline") {
      controls.scheduleSelected(date);
    } else if (date) {
      controls.snoozeSelected(date);
    }
    setOpen(false);
    setPhrase("");
    setUnparsed(false);
  }

  function applyPhrase() {
    const p = phrase.trim();
    if (!p) return;
    const { due_date } = parseDatePhrase(p);
    if (due_date) apply(due_date);
    else setUnparsed(true);
  }

  const presets = [
    ...(mode === "snooze" ? [] : [{ label: "Today", date: today }]),
    { label: "Tomorrow", date: addDaysStr(today, 1) },
    { label: "Next week", date: addDaysStr(today, 7) },
  ];

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setUnparsed(false);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" title="Plan, set a deadline or snooze to any date">
          <CalendarIcon className="h-4 w-4" />
          Date…
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="w-[18.5rem] p-2">
        <div role="radiogroup" aria-label="Which date" className="mb-1 flex gap-1 rounded-md bg-surface-2 p-0.5">
          {(Object.keys(MODE_LABEL) as BulkDateMode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "flex-1 rounded px-2 py-1 text-xs transition-colors",
                mode === m
                  ? "bg-surface font-medium text-foreground shadow-sm"
                  : "text-muted hover:text-foreground"
              )}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <p className="mb-2 px-1 text-[11px] text-subtle">
          {MODE_HINT[mode]} Applies to {controls.count}.
        </p>
        <input
          value={phrase}
          onChange={(e) => {
            setPhrase(e.target.value);
            setUnparsed(false);
          }}
          onKeyDown={(e) => e.key === "Enter" && applyPhrase()}
          placeholder="Type a date… e.g. next fri, oct 3"
          aria-label="Type a date"
          className="mb-1 h-8 w-full rounded-md border border-dashed border-input bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-subtle focus:border-primary"
        />
        {unparsed && (
          <p className="mb-1 px-1 text-[11px] text-danger">Could not read that as a date.</p>
        )}
        <div className="my-2 flex flex-wrap gap-1">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => apply(p.date)}
              className="rounded-md bg-surface-2 px-2 py-1 text-xs text-foreground transition-colors hover:bg-surface-2/70"
            >
              {p.label}
            </button>
          ))}
        </div>
        <Suspense fallback={<div className="p-4 text-xs text-subtle">Loading…</div>}>
          <Calendar
            mode="single"
            onSelect={(d) => d && apply(format(d, "yyyy-MM-dd"))}
          />
        </Suspense>
        {mode !== "snooze" && (
          <button
            type="button"
            onClick={() => apply(null)}
            className="mt-1 w-full rounded px-2 py-1 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            {mode === "plan" ? "Clear the plan" : "Clear the deadline"}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

// The rest of the bulk actions.
//
// Her report: "with the multiselect on the task lists I can do things like make
// all optional and others, right now I can only do the basics." The basics were
// complete / reschedule / snooze / backlog / delete, and every field the sheet
// had gained since (priority, optional, whenever, and moving into an area or a
// project) had no bulk form at all.
//
// A flat menu with labelled groups rather than nested submenus: the dropdown
// primitive here has no Sub, and the Cadences page already sets this pattern for
// "pick one of many areas".
function BulkMore({
  controls,
  today,
}: {
  controls: TaskControls;
  today: string;
}) {
  const { data: areas = [] } = useAreas();
  const { data: projects = [] } = useProjects();
  const n = controls.count;
  const live = projects.filter((p) => p.status === "active");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          title="More bulk actions"
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm text-foreground transition-colors hover:bg-surface"
        >
          <MoreIcon className="h-4 w-4" />
          More
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-56 overflow-y-auto">
        <DropdownMenuLabel>Priority</DropdownMenuLabel>
        <div className="flex gap-1 px-2 pb-1.5">
          {[1, 2, 3, 4].map((p) => (
            <button
              key={p}
              onClick={() =>
                controls.bulkUpdate({ priority: p }, (c) => `${c} set to P${p}`)
              }
              className="flex-1 rounded-md border border-border py-1 text-xs text-foreground transition-colors hover:border-primary hover:bg-surface-2"
            >
              P{p}
            </button>
          ))}
        </div>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Mark</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() =>
            controls.bulkUpdate({ optional: 1 }, (c) => `${c} marked optional`)
          }
        >
          Optional
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            controls.bulkUpdate({ optional: 0 }, (c) => `${c} made commitments`)
          }
        >
          Not optional
        </DropdownMenuItem>
        {/* The server clears the dates when this flag goes on, and says so; see
            shared/dates applyWheneverRule. */}
        <DropdownMenuItem
          onSelect={() =>
            controls.bulkUpdate({ whenever: 1 }, (c) => `${c} moved to Whenever`)
          }
        >
          Whenever (drops their dates)
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            controls.bulkUpdate({ whenever: 0 }, (c) => `${c} taken out of Whenever`)
          }
        >
          Not whenever
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Plan</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() =>
            controls.bulkUpdate({ planned_date: null }, (c) => `${c} unplanned`)
          }
        >
          Clear the plan
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => controls.scheduleSelected(today)}>
          Set deadline: today
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => controls.scheduleSelected(null)}>
          Clear the deadline
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Move {n} to</DropdownMenuLabel>
        <DropdownMenuItem onSelect={controls.moveSelectedToBacklog}>
          Backlog (no section)
        </DropdownMenuItem>
        {areas.map((a) => (
          <DropdownMenuItem
            key={a.id}
            onSelect={() =>
              // An area clears any project, exactly as the sheet's picker does:
              // a task cannot sit in a project belonging to a different area.
              controls.bulkUpdate(
                { area_id: a.id, project_id: null },
                (c) => `${c} moved to ${a.name}`
              )
            }
          >
            {a.name}
          </DropdownMenuItem>
        ))}
        {live.map((pr) => (
          <DropdownMenuItem
            key={pr.id}
            onSelect={() =>
              controls.bulkUpdate(
                { project_id: pr.id, area_id: pr.area_id },
                (c) => `${c} moved to ${pr.name}`
              )
            }
          >
            <span className="pl-3 text-muted">{pr.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BarBtn({
  children,
  title,
  icon,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  // Says what the button will actually do when the label cannot. "Today" is the
  // case: it plans, it does not set a deadline.
  title?: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      title={title}
      className={danger ? "text-danger hover:bg-danger/10" : undefined}
    >
      {icon}
      {children}
    </Button>
  );
}
