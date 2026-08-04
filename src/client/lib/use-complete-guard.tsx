import { useState, type ReactNode } from "react";
import type { Task } from "../../shared/types";
import { ConfirmSubtasksDialog } from "../components/ConfirmSubtasksDialog";
import { useCompleteAllSubtasks } from "./queries";

// Finishing a task that still has open steps is nearly always a slip: the steps
// were done and never ticked, or one was genuinely forgotten. The guard asks
// before the task goes to done, and offers both honest answers (tick them all,
// or finish and leave them open) plus the bail-out.
//
// This used to live inside TaskRow alone, which meant the question was asked for
// a click on a list row and NOT for the same task dragged to the board's Done
// column, ticked in a pin, or completed with the keyboard. Same act, three
// silent paths. One hook now backs all of them:
//
//   const { guard, dialog } = useCompleteGuard();
//   guard(task, (alsoCompleteSubtasks) => ...actually complete it...);
//   ...
//   {dialog}
//
// The callback runs immediately when there is nothing to ask about, so callers
// never special-case the common path. It receives whether the user chose to tick
// the remaining steps off; the hook has already done that by then, so a caller
// that ignores the flag is still correct.
export function useCompleteGuard() {
  const completeAll = useCompleteAllSubtasks();
  const [pending, setPending] = useState<{
    tasks: Task[];
    proceed: (alsoCompleteSubtasks: boolean) => void | Promise<void>;
  } | null>(null);

  // Un-completing never asks: putting a task back is not a claim about steps.
  const needsAsking = (t: Task) =>
    t.status !== "done" && (t.subtasks ?? []).some((s) => !s.done);

  function guard(
    task: Task,
    proceed: (alsoCompleteSubtasks: boolean) => void | Promise<void>
  ) {
    guardMany([task], proceed);
  }

  // The multi-select version: ONE question for the whole selection, naming the
  // tasks that are leaving steps behind. Asking twenty times would train you to
  // click through it, which is the opposite of a guard.
  function guardMany(
    tasks: Task[],
    proceed: (alsoCompleteSubtasks: boolean) => void | Promise<void>
  ) {
    const asking = tasks.filter(needsAsking);
    if (asking.length === 0) {
      proceed(false);
      return;
    }
    setPending({ tasks: asking, proceed });
  }

  async function onConfirm(alsoCompleteSubtasks: boolean) {
    const p = pending;
    setPending(null);
    if (!p) return;
    if (alsoCompleteSubtasks)
      await Promise.all(p.tasks.map((t) => completeAll.mutateAsync(t.id)));
    await p.proceed(alsoCompleteSubtasks);
  }

  const dialog: ReactNode = (
    <ConfirmSubtasksDialog
      tasks={pending?.tasks ?? null}
      onCancel={() => setPending(null)}
      onConfirm={onConfirm}
    />
  );

  return { guard, guardMany, dialog };
}
