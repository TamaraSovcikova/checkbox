import type { Task } from "../../shared/types";
import { useUpdateTask } from "./queries";
import { useToast } from "./toast";
import { todayStr } from "./utils";
import { inTodayView, leaveTodayBody, undoLeaveTodayBody } from "./today";

// Toggle a task's membership of Today, from any surface (row, board card, grid
// card, the sheet). Add just marks intent (planned_date) without touching the
// deadline. Remove clears every trigger it safely can and snoozes to tomorrow
// past the ones it cannot (a due subtask, a due checkpoint), so the task truly
// leaves Today and falls back to its area/project (or Backlog if it has none);
// undoable. Bound to inTodayView: whatever the view shows, Remove can take out.
//
// Lived twice (TaskRow + TaskSheet) with the same body; the card renderers made
// it a third, so it moved here rather than being copied again.
export function useToggleToday() {
  const update = useUpdateTask();
  const { toast } = useToast();

  return (task: Task) => {
    const today = todayStr();
    if (inTodayView(task, today)) {
      const body = leaveTodayBody(task, today);
      update.mutate({ id: task.id, body });
      const prev = undoLeaveTodayBody(task, body);
      // Say when Remove deferred rather than cleared, so the task coming back
      // tomorrow (its subtask or checkpoint is still due) is announced, not a
      // mystery. The old toast claimed success while the view kept the task.
      toast(
        body.snoozed_until != null
          ? "Removed from Today until tomorrow"
          : "Removed from Today",
        () => update.mutate({ id: task.id, body: prev })
      );
    } else {
      update.mutate({ id: task.id, body: { planned_date: today } });
      toast("Added to Today");
    }
  };
}
