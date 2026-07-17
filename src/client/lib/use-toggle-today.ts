import type { Task } from "../../shared/types";
import { useUpdateTask } from "./queries";
import { useToast } from "./toast";
import { todayStr } from "./utils";
import { inToday, leaveTodayBody, undoLeaveTodayBody } from "./today";

// Toggle a task's membership of Today, from any surface (row, board card, grid
// card, the sheet). Add just marks intent (planned_date) without touching the
// deadline. Remove clears every trigger so the task truly leaves Today and falls
// back to its area/project (or Backlog if it has none); undoable.
//
// Lived twice (TaskRow + TaskSheet) with the same body; the card renderers made
// it a third, so it moved here rather than being copied again.
export function useToggleToday() {
  const update = useUpdateTask();
  const { toast } = useToast();

  return (task: Task) => {
    const today = todayStr();
    if (inToday(task, today)) {
      const body = leaveTodayBody(task, today);
      update.mutate({ id: task.id, body });
      const prev = undoLeaveTodayBody(task, body);
      toast("Removed from Today", () =>
        update.mutate({ id: task.id, body: prev })
      );
    } else {
      update.mutate({ id: task.id, body: { planned_date: today } });
      toast("Added to Today");
    }
  };
}
