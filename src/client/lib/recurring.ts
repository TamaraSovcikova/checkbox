import type { Task } from "../../shared/types";
import { inTodayView } from "./today";

// Recurring tasks spend most of their life waiting. "Water the plants, every
// Monday" is not something to look at on a Thursday, but it sat in the area's
// list all week alongside the work that actually needed doing.
//
// So an area's list carries a recurring task only while it is LIVE, and parks the
// rest in the area's Recurring tab. "Live" is `inTodayView`: whatever the Today
// view would hold. That was the point of the rule when it was written - use the
// definition Today already has, rather than a second private notion of "relevant"
// that drifts from it - so when Today grew to include tasks carried in by a
// subtask due today, this followed. A routine with a step due now is live.

export const isRecurring = (t: Task): boolean => !!t.recurrence;

// Waiting its turn: recurring, and not yet asking for anything today.
export const isDormant = (t: Task, today: string): boolean =>
  isRecurring(t) && !inTodayView(t, today);

// Split a list into what belongs in the area's list vs what is merely pending.
// A recurring task that IS live stays in `active`: at that point it is work like
// any other, and hiding it in a tab would be how you miss it.
export function splitDormantRecurring(
  tasks: Task[],
  today: string
): { active: Task[]; dormant: Task[] } {
  const active: Task[] = [];
  const dormant: Task[] = [];
  for (const t of tasks) (isDormant(t, today) ? dormant : active).push(t);
  return { active, dormant };
}
