import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Task } from "../../shared/types";
import { dateBlocked } from "../lib/blocked";
import { todayStr } from "@/lib/utils";

// Hover preview for a task row: its notes and what it is waiting on, so you can
// read the context without opening the sheet. Opens after a deliberate pause
// (a fast mouse pass over a list must not flash cards), closes the moment the
// pointer leaves, and renders nothing at all for tasks with nothing to show.
//
// Mouse-only by design: touch has no hover, and the tap already opens the sheet.

const OPEN_DELAY_MS = 500;
const CARD_WIDTH = 320;

export function useTaskHover(task: Task, disabled?: boolean) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const timer = useRef<number | null>(null);

  const today = todayStr();
  const openBlockers = (task.depends_on ?? []).filter((d) => d.status !== "done");
  const waitDate = dateBlocked(task, today) ? task.blocked_until : null;
  const hasContent =
    task.status !== "done" &&
    (!!task.notes?.trim() || openBlockers.length > 0 || !!waitDate);

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const close = () => {
    clear();
    setAnchor(null);
  };

  // A card floating over a scrolled list would drift off its row; close instead.
  useEffect(() => {
    if (!anchor) return;
    const onScroll = () => close();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("wheel", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("wheel", onScroll);
    };
  }, [anchor]);

  useEffect(() => clear, []);

  const hoverProps =
    !hasContent || disabled
      ? {}
      : {
          onMouseEnter: (e: React.MouseEvent) => {
            const el = e.currentTarget as HTMLElement;
            clear();
            timer.current = window.setTimeout(
              () => setAnchor(el.getBoundingClientRect()),
              OPEN_DELAY_MS
            );
          },
          onMouseLeave: close,
          // Starting any interaction is a stronger intent than reading; get out
          // of the way (also covers drag start, which keeps the pointer inside).
          onMouseDown: close,
        };

  const card =
    anchor && hasContent && !disabled ? (
      <TaskHoverCardBody task={task} anchor={anchor} openBlockers={openBlockers} waitDate={waitDate} />
    ) : null;

  return { hoverProps, card };
}

function TaskHoverCardBody({
  task,
  anchor,
  openBlockers,
  waitDate,
}: {
  task: Task;
  anchor: DOMRect;
  openBlockers: { id: string; title: string }[];
  waitDate: string | null;
}) {
  // Below the row when there is room, above it otherwise. Clamped to the
  // viewport horizontally so a card near the right edge stays readable.
  const below = anchor.bottom + 220 < window.innerHeight;
  const left = Math.max(8, Math.min(anchor.left + 24, window.innerWidth - CARD_WIDTH - 8));
  const style: React.CSSProperties = {
    position: "fixed",
    left,
    width: CARD_WIDTH,
    zIndex: 60,
    ...(below
      ? { top: anchor.bottom + 4 }
      : { bottom: window.innerHeight - anchor.top + 4 }),
  };

  const sections: ReactNode[] = [];
  if (task.notes?.trim()) {
    sections.push(
      <p
        key="notes"
        className="line-clamp-[8] whitespace-pre-wrap text-xs leading-relaxed text-foreground"
      >
        {task.notes.trim()}
      </p>
    );
  }
  if (openBlockers.length > 0 || waitDate) {
    sections.push(
      <div key="blockers" className="space-y-1">
        <div className="text-[11px] font-medium uppercase tracking-wide text-warning">
          Waiting on
        </div>
        {waitDate && <div className="text-xs text-subtle">until {waitDate}</div>}
        {openBlockers.map((b) => (
          <div key={b.id} className="flex items-start gap-1.5 text-xs text-foreground">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-warning" />
            <span className="min-w-0 flex-1">{b.title}</span>
          </div>
        ))}
      </div>
    );
  }

  return createPortal(
    <div
      style={style}
      // pointer-events none: the card is read-only and must never trap the
      // mouse (hovering onto it would otherwise fight the row's mouseleave).
      className="pointer-events-none space-y-2 rounded-lg border border-border bg-surface p-3 shadow-xl"
    >
      {sections}
    </div>,
    document.body
  );
}
