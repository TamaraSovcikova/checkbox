import type { Task } from "../../shared/types";
import { computeCapacity, fmtMin } from "../../shared/capacity";
import { useCalendarRange } from "../lib/queries";
import { todayStr } from "../lib/utils";
import { cn } from "@/lib/utils";

// One quiet line under Today's controls: does what you planned still fit in
// the day? Estimates come from the open Today tasks; free time is now -> 22:00
// minus today's timed calendar events. Rendered only when at least one task
// carries an estimate: no estimates means nothing worth warning about.
export function CapacityLine({ tasks }: { tasks: Task[] }) {
  const today = todayStr();
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const { data: events = [] } = useCalendarRange(today, tomorrow);

  const open = tasks.filter((t) => t.status !== "done");
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const busy: [number, number][] = events
    .filter((e) => !e.all_day && e.start.slice(0, 10) === today)
    .map((e) => {
      const s = new Date(e.start);
      const en = new Date(e.end);
      return [s.getHours() * 60 + s.getMinutes(), en.getHours() * 60 + en.getMinutes()] as [
        number,
        number,
      ];
    });

  const cap = computeCapacity(
    open.map((t) => t.time_estimate_min),
    busy,
    nowMin
  );
  if (cap.plannedMin === 0) return null;

  return (
    <p className={cn("mb-3 px-1 text-xs", cap.over ? "text-warning" : "text-subtle")}>
      Planned {fmtMin(cap.plannedMin)}
      {" · "}
      {fmtMin(cap.freeMin)} free before 22:00
      {cap.over && " · more than fits today"}
      {cap.unestimated > 0 && (
        <span className="text-subtle">
          {" · "}
          {cap.unestimated} without estimate
        </span>
      )}
    </p>
  );
}
