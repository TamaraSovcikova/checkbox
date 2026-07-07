import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { Template, TemplateItem, Priority } from "../../shared/types";
import { useSaveTemplate } from "../lib/queries";
import { Button, Input } from "./ui";
import { CloseIcon, AddIcon, TrashIcon } from "../lib/icons";

type DraftItem = {
  title: string;
  priority: Priority;
  offset_days: number | "";
};

function toDraft(items: TemplateItem[]): DraftItem[] {
  return items.map((i) => ({
    title: i.title,
    priority: i.priority,
    offset_days: i.offset_days ?? "",
  }));
}

// Create / edit a reusable template: a name + an ordered list of task blueprints,
// each with a priority and an optional due-date offset (days from apply date).
export function TemplateDialog({
  open,
  onOpenChange,
  existing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existing?: Template;
}) {
  const save = useSaveTemplate();
  const [name, setName] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);

  useEffect(() => {
    if (open) {
      setName(existing?.name ?? "");
      setItems(
        existing?.items?.length
          ? toDraft(existing.items)
          : [{ title: "", priority: 4, offset_days: "" }]
      );
    }
  }, [open, existing]);

  function setItem(i: number, patch: Partial<DraftItem>) {
    setItems((cur) => cur.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems((cur) => [...cur, { title: "", priority: 4, offset_days: "" }]);
  }
  function removeItem(i: number) {
    setItems((cur) => cur.filter((_, idx) => idx !== i));
  }

  async function submit() {
    if (!name.trim()) return;
    const clean = items
      .filter((it) => it.title.trim())
      .map((it) => ({
        title: it.title.trim(),
        priority: it.priority,
        offset_days: it.offset_days === "" ? null : Number(it.offset_days),
      }));
    await save.mutateAsync({
      id: existing?.id,
      body: { name: name.trim(), items: clean as unknown as TemplateItem[] },
    });
    onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[32rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-surface p-5 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold text-foreground">
              {existing ? "Edit template" : "New template"}
            </Dialog.Title>
            <Dialog.Close className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground">
              <CloseIcon className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <label className="block text-xs text-muted">
            Template name
            <div className="mt-1">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Trip prep, Weekly sprint"
                autoFocus
              />
            </div>
          </label>

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
            <div className="mb-1.5 flex items-center gap-2 px-1 text-[11px] uppercase tracking-wide text-subtle">
              <span className="flex-1">Task</span>
              <span className="w-12 text-center">P</span>
              <span className="w-16 text-center" title="Due date offset in days from apply date">
                +days
              </span>
              <span className="w-6" />
            </div>
            <div className="space-y-1.5">
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={it.title}
                    onChange={(e) => setItem(i, { title: e.target.value })}
                    placeholder="Task title"
                    className="flex-1"
                  />
                  <select
                    value={it.priority}
                    onChange={(e) =>
                      setItem(i, { priority: Number(e.target.value) as Priority })
                    }
                    className="h-9 w-12 rounded-md border border-input bg-surface text-center text-sm text-foreground outline-none focus:border-primary"
                  >
                    {[1, 2, 3, 4].map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    value={it.offset_days}
                    onChange={(e) =>
                      setItem(i, {
                        offset_days: e.target.value === "" ? "" : Number(e.target.value),
                      })
                    }
                    placeholder="—"
                    className="w-16 text-center"
                  />
                  <button
                    onClick={() => removeItem(i)}
                    aria-label="Remove item"
                    className="grid h-8 w-6 place-items-center text-subtle hover:text-danger"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={addItem}
              className="mt-2 flex items-center gap-1 text-xs text-primary hover:text-primary-hover"
            >
              <AddIcon className="h-3.5 w-3.5" /> Add task
            </button>
          </div>

          <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={!name.trim() || save.isPending}>
              {existing ? "Save" : "Create template"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
