import { useCallback, useEffect, useRef, useState } from "react";
import type { Task } from "../../shared/types";
import { api } from "../lib/api";
import { useTaskInvalidate } from "../lib/queries";
import { useToast } from "../lib/toast";
import { CheckIcon, TrashIcon, RescheduleIcon, BacklogIcon, CloseIcon, SnoozeIcon } from "../lib/icons";
import { Button } from "./ui";

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
  rowFor: (task: Task, index: number) => RowSelection;
  clear: () => void;
  // bulk operations
  completeSelected: () => void;
  deleteSelected: () => void;
  scheduleSelected: (date: string | null) => void;
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
    Promise.all(items.map((t) => api.completeTask(t.id, true)))
      .then(invalidate);
    clear();
    toast(`${items.length} completed`, () => {
      Promise.all(items.map((t) => api.completeTask(t.id, false))).then(invalidate);
    });
  }, [selectedTasks, invalidate, clear, toast]);

  const deleteSelected = useCallback(() => {
    const items = selectedTasks();
    if (!items.length) return;
    Promise.all(items.map((t) => api.deleteTask(t.id))).then(invalidate);
    clear();
    toast(`${items.length} deleted`, () => {
      Promise.all(items.map((t) => api.restoreTask(t))).then(invalidate);
    });
  }, [selectedTasks, invalidate, clear, toast]);

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
          if (cur) {
            api.completeTask(cur.id, true).then((r) => {
              invalidate();
              if (r?.recurred && r.due_date) toast(`Recurring — next ${r.due_date}`);
              else
                toast("Completed", () => {
                  api.completeTask(cur.id, false).then(invalidate);
                });
            });
          }
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
  }, [enabled, tasks, cursor, toggle, onOpen, selectedIds, clear, invalidate, toast]);

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
          // opening — matches Gmail/Todoist multi-select ergonomics.
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
    rowFor,
    clear,
    completeSelected,
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
      <span className="px-2 text-sm font-medium text-foreground">
        {controls.count} selected
      </span>
      <div className="mx-1 h-5 w-px bg-border" />
      <BarBtn onClick={controls.completeSelected} icon={<CheckIcon className="h-4 w-4" />}>
        Complete
      </BarBtn>
      <BarBtn
        onClick={() => controls.scheduleSelected(today)}
        icon={<RescheduleIcon className="h-4 w-4" />}
      >
        Today
      </BarBtn>
      <BarBtn onClick={() => controls.scheduleSelected(addDaysStr(today, 1))}>
        Tomorrow
      </BarBtn>
      <BarBtn
        onClick={() => controls.snoozeSelected(addDaysStr(today, 1))}
        icon={<SnoozeIcon className="h-4 w-4" />}
      >
        Snooze
      </BarBtn>
      <BarBtn
        onClick={controls.moveSelectedToBacklog}
        icon={<BacklogIcon className="h-4 w-4" />}
      >
        Backlog
      </BarBtn>
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

function BarBtn({
  children,
  icon,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className={danger ? "text-danger hover:bg-danger/10" : undefined}
    >
      {icon}
      {children}
    </Button>
  );
}
