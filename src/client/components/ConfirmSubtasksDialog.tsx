import * as Dialog from "@radix-ui/react-dialog";
import type { Task } from "../../shared/types";
import { Button } from "./ui";
import { CloseIcon } from "../lib/icons";

// Guard on completing tasks that still have open subtasks.
//
// Two ways to say yes, because they mean different things:
//   "Complete all"  -> the subtasks really are done, I just never ticked them.
//   "Finish anyway" -> the subtasks are moot; the parent is done regardless.
//
// Only the first rewrites subtask state, so the second leaves an honest record
// of what was actually never finished.
//
// Takes a LIST, because the same question has to be asked of a multi-select
// finishing twenty tasks at once. One task shows its steps; several show the
// tasks and how many steps each is leaving behind, since twenty tasks' worth of
// step titles is a wall nobody reads.
export function ConfirmSubtasksDialog({
  tasks,
  onCancel,
  onConfirm,
}: {
  tasks: Task[] | null;
  onCancel: () => void;
  onConfirm: (completeAll: boolean) => void;
}) {
  const list = tasks ?? [];
  const open = list.length > 0;
  const openSteps = (t: Task) => (t.subtasks ?? []).filter((s) => !s.done);
  const total = list.reduce((n, t) => n + openSteps(t).length, 0);
  const single = list.length === 1 ? list[0] : null;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[26rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-5 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="mb-3 flex items-start justify-between gap-3">
            <Dialog.Title className="text-base font-semibold text-foreground">
              {total} unfinished subtask{total === 1 ? "" : "s"}
              {single ? "" : ` across ${list.length} tasks`}
            </Dialog.Title>
            <Dialog.Close className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground">
              <CloseIcon className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <Dialog.Description className="text-sm text-muted">
            {single ? (
              <>
                “{single.title}” still has{" "}
                {total === 1 ? "a subtask that is" : "subtasks that are"} not
                ticked off. Mark the task as done anyway?
              </>
            ) : (
              <>
                Some of the tasks you are finishing still have subtasks that are
                not ticked off. Mark them all as done anyway?
              </>
            )}
          </Dialog.Description>

          <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-md bg-surface-2/60 p-2">
            {single
              ? openSteps(single).map((s) => (
                  <li key={s.id} className="text-sm text-foreground">
                    {s.title}
                  </li>
                ))
              : list.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-baseline justify-between gap-3 text-sm text-foreground"
                  >
                    <span className="min-w-0 truncate">{t.title}</span>
                    <span className="shrink-0 text-[11px] text-subtle">
                      {openSteps(t).length} open
                    </span>
                  </li>
                ))}
          </ul>

          <div className="mt-5 flex flex-col gap-2">
            <Button onClick={() => onConfirm(true)}>
              Complete all {total} and finish
            </Button>
            <Button variant="subtle" onClick={() => onConfirm(false)}>
              Finish anyway, leave subtasks open
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
