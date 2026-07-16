import type { Task } from "../../shared/types";
import { inToday } from "./today";

// Recurring tasks spend most of their life waiting. "Water the plants, every
// Monday" is not something to look at on a Thursday, but it sat in the area's
// list all week alongside the work that actually needed doing.
//
// So an area's list carries a recurring task only while it is LIVE, and parks the
// rest in the area's Recurring tab. "Live" is `inToday`: due today, overdue,
// planned for today, or time-blocked today. That is the same rule the Today view
// uses (and mirrors the server's /views/today), rather than a second private
// definition of "relevant" that could drift from it.

export const isRecurring = (t: Task): boolean => !!t.recurrence;

// Waiting its turn: recurring, and not yet asking for anything today.
export const isDormant = (t: Task, today: string): boolean =>
  isRecurring(t) && !inToday(t, today);

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
