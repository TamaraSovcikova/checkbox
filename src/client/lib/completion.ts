import type { Task } from "../../shared/types";

// What the toast says when a task is finished.
//
// One place, because three surfaces complete a task and all three should report
// the same consequences. The second half is the important one: completing a
// blocker now PLANS whatever it was holding up for today (worker/lib/unblock),
// and an automatic write you cannot see is how a tool stops being predictable.
// So the toast names them.
export function completedMessage(
  task: Pick<Task, "recurrence">,
  result?: { unblocked?: { id: string; title: string }[] }
): string {
  // A recurring task stays crossed out for the rest of the day and the morning
  // sweep wakes the next occurrence: say so, so its calm is never mistaken for
  // the repeat being broken.
  const base = task.recurrence
    ? "Done for today · repeats tomorrow morning"
    : "Completed";
  const freed = result?.unblocked ?? [];
  if (!freed.length) return base;
  // Named at one, counted beyond that: three titles in a toast is a wall.
  const who =
    freed.length === 1
      ? `"${freed[0].title}"`
      : `${freed.length} tasks`;
  return `${base} · unblocked ${who}, planned for today`;
}
