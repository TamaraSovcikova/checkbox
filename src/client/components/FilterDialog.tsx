import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useNavigate } from "react-router-dom";
import type { FilterQuery, SavedFilter, Priority } from "../../shared/types";
import { useAreas, useLabels, useProjects } from "../lib/queries";
import { useCreateFilter, useUpdateFilter } from "../lib/queries";
import { Button, Input } from "./ui";
import { CloseIcon } from "../lib/icons";

// Build / edit a saved filter. On create it navigates to the new filter view.
export function FilterDialog({
  open,
  onOpenChange,
  existing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existing?: SavedFilter;
}) {
  const { data: areas = [] } = useAreas();
  const { data: projects = [] } = useProjects();
  const { data: labels = [] } = useLabels();
  const create = useCreateFilter();
  const update = useUpdateFilter();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [q, setQ] = useState<FilterQuery>({});

  useEffect(() => {
    if (open) {
      setName(existing?.name ?? "");
      setQ(existing?.query ?? {});
    }
  }, [open, existing]);

  const set = (patch: Partial<FilterQuery>) => setQ((cur) => ({ ...cur, ...patch }));

  async function submit() {
    if (!name.trim()) return;
    // strip empty/any fields so the stored query stays minimal
    const clean: FilterQuery = {};
    if (q.text?.trim()) clean.text = q.text.trim();
    if (q.priority_max) clean.priority_max = q.priority_max;
    if (q.label) clean.label = q.label;
    if (q.area_id) clean.area_id = q.area_id;
    if (q.project_id) clean.project_id = q.project_id;
    if (q.due && q.due !== "any") clean.due = q.due;
    if (q.status && q.status !== "open") clean.status = q.status;

    if (existing) {
      await update.mutateAsync({ id: existing.id, body: { name: name.trim(), query: clean } });
      onOpenChange(false);
    } else {
      const f = await create.mutateAsync({ name: name.trim(), query: clean });
      onOpenChange(false);
      navigate(`/filter/${f.id}`);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[26rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-5 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold text-foreground">
              {existing ? "Edit filter" : "New filter"}
            </Dialog.Title>
            <Dialog.Close className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground">
              <CloseIcon className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="space-y-3">
            <Field label="Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. This week's errands"
                autoFocus
              />
            </Field>

            <Field label="Text contains">
              <Input
                value={q.text ?? ""}
                onChange={(e) => set({ text: e.target.value })}
                placeholder="Any title or notes text"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Priority ≤">
                <Select
                  value={q.priority_max ? String(q.priority_max) : ""}
                  onChange={(v) => set({ priority_max: v ? (Number(v) as Priority) : undefined })}
                  options={[
                    ["", "Any"],
                    ["1", "P1"],
                    ["2", "P2"],
                    ["3", "P3"],
                    ["4", "P4"],
                  ]}
                />
              </Field>
              <Field label="Due">
                <Select
                  value={q.due ?? "any"}
                  onChange={(v) => set({ due: v as FilterQuery["due"] })}
                  options={[
                    ["any", "Any"],
                    ["overdue", "Overdue"],
                    ["today", "Today"],
                    ["week", "This week"],
                    ["none", "No date"],
                  ]}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Label">
                <Select
                  value={q.label ?? ""}
                  onChange={(v) => set({ label: v || undefined })}
                  options={[["", "Any"], ...labels.map((l) => [l.name, `@${l.name}`] as [string, string])]}
                />
              </Field>
              <Field label="Status">
                <Select
                  value={q.status ?? "open"}
                  onChange={(v) => set({ status: v as FilterQuery["status"] })}
                  options={[
                    ["open", "Open"],
                    ["done", "Completed"],
                    ["any", "Any"],
                  ]}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Area">
                <Select
                  value={q.area_id ?? ""}
                  onChange={(v) => set({ area_id: v || undefined })}
                  options={[["", "Any"], ...areas.map((a) => [a.id, a.name] as [string, string])]}
                />
              </Field>
              <Field label="Project">
                <Select
                  value={q.project_id ?? ""}
                  onChange={(v) => set({ project_id: v || undefined })}
                  options={[["", "Any"], ...projects.map((p) => [p.id, p.name] as [string, string])]}
                />
              </Field>
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={!name.trim()}>
              {existing ? "Save" : "Create filter"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-muted">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm text-foreground outline-none focus:border-primary"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
