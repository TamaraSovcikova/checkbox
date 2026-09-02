import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useNavigate } from "react-router-dom";
import type {
  FilterQuery,
  SavedFilter,
  Priority,
  DateFilter,
  TriState,
} from "../../shared/types";
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
    if (q.planned && q.planned !== "any") clean.planned = q.planned;
    // Bounds only mean anything in range mode, so they are not carried when the
    // mode has moved on: a stored filter should describe what it does, and a
    // stale `due_from` sitting under "Overdue" is a question waiting to be asked
    // wrongly the next time someone reads it.
    if (q.due === "range") {
      if (q.due_from) clean.due_from = q.due_from;
      if (q.due_to) clean.due_to = q.due_to;
    }
    if (q.planned === "range") {
      if (q.planned_from) clean.planned_from = q.planned_from;
      if (q.planned_to) clean.planned_to = q.planned_to;
    }
    if (q.status && q.status !== "open") clean.status = q.status;
    for (const k of ["whenever", "optional", "recurring", "blocked"] as const) {
      const v = q[k];
      if (v && v !== "any") clean[k] = v;
    }

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
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-3rem)] w-[26rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-surface p-5 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="mb-4 flex shrink-0 items-center justify-between">
            <Dialog.Title className="text-base font-semibold text-foreground">
              {existing ? "Edit filter" : "New filter"}
            </Dialog.Title>
            <Dialog.Close className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground">
              <CloseIcon className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* Scrolls at the FORM, not the dialog: the title and the buttons
              stay put, so Create is always reachable however many fields there
              are. min-h-0 lets the middle actually shrink inside the column. */}
          <div className="-mx-1 min-h-0 flex-1 space-y-3 overflow-y-auto px-1">
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
                  onChange={(v) => set({ due: v as DateFilter })}
                  options={[
                    ["any", "Any"],
                    ["overdue", "Overdue"],
                    ["today", "Today"],
                    // Named for what they are: rolling windows from today, not
                    // calendar weeks or months. "This week" read as the calendar
                    // week and never was.
                    ["week", "Next 7 days"],
                    ["month", "Next 30 days"],
                    ["range", "Between…"],
                    ["none", "No due date"],
                  ]}
                />
              </Field>
              {q.due === "range" && (
                <RangeBounds
                  from={q.due_from ?? ""}
                  to={q.due_to ?? ""}
                  onChange={(p) =>
                    set({
                      ...(p.from !== undefined ? { due_from: p.from || undefined } : {}),
                      ...(p.to !== undefined ? { due_to: p.to || undefined } : {}),
                    })
                  }
                />
              )}
            </div>

            {/* The second date. Same vocabulary as Due so the two cannot mean
                different spans of days, but labelled for what a PLANNED date in
                the past actually is: not a missed deadline, a day you did not
                get to, which Today carries forward rather than marking late. */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Planned">
                <Select
                  value={q.planned ?? "any"}
                  onChange={(v) => set({ planned: v as DateFilter })}
                  options={[
                    ["any", "Any"],
                    ["overdue", "Carried over"],
                    ["today", "Today"],
                    ["week", "Next 7 days"],
                    ["month", "Next 30 days"],
                    ["range", "Between…"],
                    ["none", "Not planned"],
                  ]}
                />
              </Field>
              {q.planned === "range" && (
                <RangeBounds
                  from={q.planned_from ?? ""}
                  to={q.planned_to ?? ""}
                  onChange={(p) =>
                    set({
                      ...(p.from !== undefined
                        ? { planned_from: p.from || undefined }
                        : {}),
                      ...(p.to !== undefined ? { planned_to: p.to || undefined } : {}),
                    })
                  }
                />
              )}
              <Field label="Blocked">
                <Select
                  value={q.blocked ?? "any"}
                  onChange={(v) => set({ blocked: v as TriState })}
                  options={[
                    ["any", "Any"],
                    ["yes", "Only blocked"],
                    ["no", "Not blocked"],
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

            {/* What KIND of task, as opposed to when it is owed. Each of these
                is a flag you can already set and could not previously find by,
                which is half a feature. Worded as what the filter DOES rather
                than as yes/no, since "Recurring: no" reads as a fact about the
                task and "Exclude routines" reads as an instruction. */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Whenever">
                <Select
                  value={q.whenever ?? "any"}
                  onChange={(v) => set({ whenever: v as TriState })}
                  options={[
                    ["any", "Any"],
                    ["yes", "Only whenever"],
                    ["no", "Exclude whenever"],
                  ]}
                />
              </Field>
              <Field label="Routines">
                <Select
                  value={q.recurring ?? "any"}
                  onChange={(v) => set({ recurring: v as TriState })}
                  options={[
                    ["any", "Any"],
                    ["yes", "Only repeating"],
                    ["no", "Exclude repeating"],
                  ]}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Optional">
                <Select
                  value={q.optional ?? "any"}
                  onChange={(v) => set({ optional: v as TriState })}
                  options={[
                    ["any", "Any"],
                    ["yes", "Only optional"],
                    ["no", "Commitments only"],
                  ]}
                />
              </Field>
            </div>
          </div>

          <div className="mt-5 flex shrink-0 justify-end gap-2">
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

// The two ends of a "Between…" range.
//
// Only rendered when that mode is chosen, so the dialog does not carry two date
// inputs on every filter to serve the one that needs them. Either end may be
// left blank: blank-to means "from this date onwards", blank-from means "up to
// this date", and both blank means "has a date at all".
function RangeBounds({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (patch: { from?: string; to?: string }) => void;
}) {
  return (
    <div className="col-span-2 -mt-1 flex items-center gap-2">
      <input
        type="date"
        value={from}
        onChange={(e) => onChange({ from: e.target.value })}
        title="From (inclusive). Leave blank for no lower bound."
        className="h-9 min-w-0 flex-1 rounded-md border border-input bg-surface px-2 text-sm text-foreground outline-none focus:border-primary"
      />
      <span className="shrink-0 text-xs text-subtle">to</span>
      <input
        type="date"
        value={to}
        onChange={(e) => onChange({ to: e.target.value })}
        title="To (inclusive). Leave blank for no upper bound."
        className="h-9 min-w-0 flex-1 rounded-md border border-input bg-surface px-2 text-sm text-foreground outline-none focus:border-primary"
      />
    </div>
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
