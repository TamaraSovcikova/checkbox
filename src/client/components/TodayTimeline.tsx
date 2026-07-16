import { format } from "date-fns";
import type { CalendarEvent, Task } from "../../shared/types";
import { useCalendarStatus, useCalendarRange } from "../lib/queries";
import { useTaskUI } from "../lib/ui-context";
import { PRIORITY_VAR } from "../lib/colors";
import { packLanes, laneStyle, type Lane } from "../lib/lanes";
import {
  GRID_START,
  GRID_END,
  PX_PER_HOUR,
  GRID_HEIGHT,
  BLOCK_GAP,
  timeToPx,
  durationPx,
  effectiveInterval,
  fmtTime,
} from "../lib/grid";
import { cn } from "@/lib/utils";

// Today's day, read only: what is already booked and where today's time-blocked
// tasks sit, without leaving the list to go look.
//
// Deliberately NOT draggable, droppable or resizable, unlike the Calendar page's
// grid. Scheduling stays one place, so there is no second set of drag semantics
// to keep in step. Clicking a task still opens it, which reads rather than
// re-times it. The geometry is shared via lib/grid, so a block lands at the same
// pixel here as it does on the Calendar page.

function Block({
  top,
  height,
  lane,
  title,
  time,
  color,
  mine,
  onClick,
}: {
  top: number;
  height: number;
  lane?: Lane;
  title: string;
  time: string;
  color: string;
  mine: boolean;
  onClick?: () => void;
}) {
  if (top < 0 || top > GRID_HEIGHT) return null;
  const pos = laneStyle(lane);
  const drawH = Math.max(14, height - BLOCK_GAP);
  const compact = drawH < 30; // too short for a title + time line
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      title={`${title}${time ? ` · ${time}` : ""}`}
      className={cn(
        "absolute flex flex-col overflow-hidden rounded border border-l-2 text-left leading-none",
        mine ? "text-foreground" : "text-foreground/80",
        compact ? "justify-center px-1.5" : "px-1.5 py-0.5",
        onClick && "hover:brightness-110"
      )}
      style={{
        top,
        height: drawH,
        left: pos.left,
        width: pos.width,
        // Same language as the Calendar page: my tasks are priority-tinted with a
        // solid left bar, Google's events are a muted backdrop in their calendar's
        // colour, so "already busy" reads differently from "this is my work".
        backgroundColor: `color-mix(in oklab, ${color} ${mine ? 22 : 18}%, transparent)`,
        borderColor: `color-mix(in oklab, ${color} 30%, transparent)`,
        borderLeftColor: color,
      }}
    >
      <div className={cn("truncate font-medium", compact ? "text-[11px]" : "text-xs")}>
        {title}
      </div>
      {!compact && drawH >= 40 && (
        <div className="mt-0.5 text-[11px] text-subtle/80">{time}</div>
      )}
    </Tag>
  );
}

// The red now-line, so the day has a "you are here".
function NowLine() {
  const now = new Date();
  const top = timeToPx(now.toISOString());
  if (top < 0 || top > GRID_HEIGHT) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top }}>
      <div className="h-px bg-danger" />
      <div className="absolute -left-1 -top-[3px] h-[7px] w-[7px] rounded-full bg-danger" />
    </div>
  );
}

export function TodayTimeline({ tasks }: { tasks: Task[] }) {
  const { data: status } = useCalendarStatus();
  const { open } = useTaskUI();
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const tomorrowStr = format(
    new Date(Date.now() + 24 * 60 * 60 * 1000),
    "yyyy-MM-dd"
  );
  const { data: events = [] } = useCalendarRange(todayStr, tomorrowStr);

  if (!status?.connected) {
    return (
      <div className="rounded-xl border border-border bg-surface/40 p-4 text-center">
        <p className="text-xs text-subtle">
          Connect Google Calendar in Settings to see your day here.
        </p>
      </div>
    );
  }

  // Timed events only. All-day entries have no place on an hour grid, and the
  // Calendar page's all-day box is where those are dealt with.
  const external = events.filter(
    (e: CalendarEvent) =>
      !e.all_day &&
      !e.is_checkbox_owned &&
      format(new Date(e.start), "yyyy-MM-dd") === todayStr
  );
  const scheduled = tasks.filter(
    (t) => t.scheduled_start?.startsWith(todayStr) && t.status !== "done"
  );

  // Pack both kinds into shared lanes so an overlap sits side by side rather
  // than one hiding the other. Same packer the Calendar page uses.
  const lanes = packLanes([
    ...external.map((e) => ({ key: e.id, ...effectiveInterval(e.start, e.end) })),
    ...scheduled.map((t) => ({
      key: t.id,
      ...effectiveInterval(t.scheduled_start!, t.scheduled_end ?? t.scheduled_start!),
    })),
  ]);

  const nothing = external.length + scheduled.length === 0;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface/40">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-foreground">
          {format(new Date(), "EEEE d MMM")}
        </span>
        <span className="text-[11px] text-subtle">
          {scheduled.length} block{scheduled.length === 1 ? "" : "s"}
        </span>
        <span className="ml-auto text-[11px] text-subtle">view only</span>
      </div>

      {nothing ? (
        <p className="px-3 py-6 text-center text-xs text-subtle">
          Nothing booked today. Schedule tasks on the Calendar page.
        </p>
      ) : (
        <div className="max-h-[26rem] overflow-y-auto">
          <div className="flex gap-2 px-2 py-2">
            {/* Hour labels */}
            <div className="relative w-7 shrink-0" style={{ height: GRID_HEIGHT }}>
              {Array.from(
                { length: GRID_END - GRID_START },
                (_, i) => GRID_START + i
              ).map((h) => (
                <div
                  key={h}
                  className="absolute right-0 text-[10px] leading-none text-subtle"
                  style={{ top: (h - GRID_START) * PX_PER_HOUR - 5 }}
                >
                  {String(h).padStart(2, "0")}
                </div>
              ))}
            </div>

            <div className="relative min-w-0 flex-1" style={{ height: GRID_HEIGHT }}>
              {/* Hour rules. Plain lines: nothing here is a drop target. */}
              {Array.from(
                { length: GRID_END - GRID_START },
                (_, i) => GRID_START + i
              ).map((h) => (
                <div
                  key={h}
                  className="absolute inset-x-0 border-t border-border"
                  style={{ top: (h - GRID_START) * PX_PER_HOUR }}
                />
              ))}

              {external.map((e) => (
                <Block
                  key={e.id}
                  top={timeToPx(e.start)}
                  height={durationPx(e.start, e.end)}
                  lane={lanes.get(e.id)}
                  title={e.title ?? "(no title)"}
                  time={fmtTime(e.start)}
                  color={e.color ?? "var(--muted)"}
                  mine={false}
                />
              ))}
              {scheduled.map((t) => (
                <Block
                  key={t.id}
                  top={timeToPx(t.scheduled_start!)}
                  height={durationPx(t.scheduled_start!, t.scheduled_end ?? t.scheduled_start!)}
                  lane={lanes.get(t.id)}
                  title={t.title}
                  time={`${fmtTime(t.scheduled_start!)}${
                    t.scheduled_end ? `-${fmtTime(t.scheduled_end)}` : ""
                  }`}
                  color={PRIORITY_VAR[t.priority]}
                  mine
                  onClick={() => open(t)}
                />
              ))}
              <NowLine />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
