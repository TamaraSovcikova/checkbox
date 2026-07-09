import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import type { Project } from "../../shared/types";
import { api } from "../lib/api";
import { CloseIcon } from "../lib/icons";
import { Button, Input } from "./ui";

// Create or edit a project (sprint). The update API (PATCH /api/projects/:id)
// already existed; this is the missing client surface. Board columns are edited
// as a comma-separated list — enough control without a full column editor.
export function ProjectDialog({
  open,
  onOpenChange,
  existing,
  areaId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existing?: Project;
  // Required when creating (the area the new project belongs to).
  areaId?: string | null;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [columns, setColumns] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(existing?.name ?? "");
      setGoal(existing?.goal ?? "");
      setDescription(existing?.description ?? "");
      setDueDate(existing?.due_date ?? "");
      setColumns((existing?.board_columns ?? ["To do", "Doing", "Done"]).join(", "));
    }
  }, [open, existing]);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const board_columns = columns
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      // Only send board_columns when there is at least one — an empty array would
      // wipe the board. The PATCH route includes any key present in the body, so
      // omit it entirely rather than passing undefined.
      const body: Partial<Project> = {
        name: name.trim(),
        goal: goal.trim() || null,
        description: description.trim() || null,
        due_date: dueDate.trim() || null,
        ...(board_columns.length ? { board_columns } : {}),
      };
      if (existing) await api.updateProject(existing.id, body);
      else await api.createProject({ ...body, area_id: areaId ?? null });
      qc.invalidateQueries({ queryKey: ["projects"] });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[26rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-5 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold text-foreground">
              {existing ? "Edit project" : "New project"}
            </Dialog.Title>
            <Dialog.Close className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground">
              <CloseIcon className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <label className="block text-xs text-muted">
            Name
            <div className="mt-1">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="e.g. Q3 sprint, Kitchen reno"
                autoFocus
              />
            </div>
          </label>

          <label className="mt-3 block text-xs text-muted">
            Goal
            <div className="mt-1">
              <Input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="One-line outcome (optional)"
              />
            </div>
          </label>

          <label className="mt-3 block text-xs text-muted">
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Notes / context (optional)"
              className="mt-1 w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-subtle focus:border-primary"
            />
          </label>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block text-xs text-muted">
              Due date
              <div className="mt-1">
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </label>
            <label className="block text-xs text-muted">
              Board columns
              <div className="mt-1">
                <Input
                  value={columns}
                  onChange={(e) => setColumns(e.target.value)}
                  placeholder="To do, Doing, Done"
                />
              </div>
            </label>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={!name.trim() || busy}>
              {existing ? "Save" : "Create project"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
