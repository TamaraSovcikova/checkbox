import { useState } from "react";
import type { Tracker } from "../../shared/types";
import {
  useTrackers,
  useCreateTracker,
  useUpdateTracker,
  useDeleteTracker,
  useLogTracker,
  useUnlogTracker,
  useAreas,
} from "../lib/queries";
import { useToast } from "../lib/toast";
import {
  cadenceFill,
  cadenceStatus,
  daysSince,
  sinceLabel,
  sortByUrgency,
  type CadenceStatus,
} from "../lib/cadence";
import { areaColorVar } from "../lib/colors";
import { todayStr } from "@/lib/utils";
import { Button } from "./ui/button";
import { AddIcon, TrashIcon, CadenceIcon } from "../lib/icons";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/dropdown-menu";

// Cadence trackers: things measured by "how long since", not "when is it due".
// See migration 0026 for why these are not tasks.

const STATUS_COLOR: Record<CadenceStatus, string> = {
  fresh: "var(--success)",
  soon: "var(--warning)",
  due: "var(--danger)",
  never: "var(--muted)",
};

// The bar. Fill is days-since against the target; the colour is what escalates
// once past it, since the fill itself is clamped at full.
function CadenceBar({ tracker, today }: { tracker: Tracker; today: string }) {
  const status = cadenceStatus(tracker, today);
  const fill = cadenceFill(tracker, today);
  const colour = STATUS_COLOR[status];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        className="h-full rounded-full transition-[width]"
        style={{
          width: `${Math.round(fill * 100)}%`,
          backgroundColor: colour,
        }}
      />
    </div>
  );
}

function CadenceRow({ tracker }: { tracker: Tracker }) {
  const today = todayStr();
  const log = useLogTracker();
  const unlog = useUnlogTracker();
  const update = useUpdateTracker();
  const del = useDeleteTracker();
  const { toast } = useToast();
  const { data: areas = [] } = useAreas();
  const area = areas.find((a) => a.id === tracker.area_id);

  const status = cadenceStatus(tracker, today);
  const since = daysSince(tracker, today);

  async function onLog(occurredAt?: string) {
    const res = await log.mutateAsync({ id: tracker.id, occurred_at: occurredAt });
    // Undo removes the exact row just written, so a double log followed by an
    // undo cannot delete the wrong one.
    toast(`Logged ${tracker.name}`, () =>
      unlog.mutate({ id: tracker.id, eventId: res.event_id })
    );
  }

  // Backdating: the common real case is "I actually did this a few days ago".
  function logDaysAgo(n: number) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    onLog(d.toISOString());
  }

  return (
    <div className="rounded-lg border border-border bg-surface/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        {area && (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: areaColorVar(area.color) }}
            title={area.name}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {tracker.name}
        </span>

        <span
          className="shrink-0 text-xs tabular-nums"
          style={{ color: STATUS_COLOR[status] }}
          title={tracker.last_at ? `Last: ${tracker.last_at.slice(0, 10)}` : "Never logged"}
        >
          {sinceLabel(tracker, today)}
        </span>

        <Button size="sm" variant="secondary" onClick={() => onLog()}>
          Log
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`More for ${tracker.name}`}
              className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              ···
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => logDaysAgo(1)}>
              Log for yesterday
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => logDaysAgo(3)}>
              Log for 3 days ago
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => logDaysAgo(7)}>
              Log for a week ago
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                const raw = window.prompt(
                  `Target cadence for "${tracker.name}" in days (blank = just count, no target)`,
                  tracker.target_days ? String(tracker.target_days) : ""
                );
                if (raw === null) return;
                const n = Number(raw.trim());
                update.mutate({
                  id: tracker.id,
                  body: { target_days: raw.trim() && n > 0 ? n : null },
                });
              }}
            >
              Set cadence
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => update.mutate({ id: tracker.id, body: { archived: true } })}>
              Archive
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (window.confirm(`Delete "${tracker.name}" and its whole history?`)) {
                  del.mutate(tracker.id);
                }
              }}
            >
              <TrashIcon className="h-3.5 w-3.5" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <CadenceBar tracker={tracker} today={today} />
        </div>
        <span className="shrink-0 text-[11px] text-subtle">
          {tracker.target_days == null
            ? "no target"
            : since == null
            ? `every ${tracker.target_days}d`
            : `${since}/${tracker.target_days}d`}
        </span>
      </div>
    </div>
  );
}

// Add a tracker. Name plus an optional cadence, because the cadence is the part
// people hesitate over and it must not block writing the name down.
function AddCadence() {
  const create = useCreateTracker();
  const [name, setName] = useState("");
  const [days, setDays] = useState("");

  function submit() {
    const n = name.trim();
    if (!n) return;
    const t = Number(days.trim());
    create.mutate({ name: n, target_days: days.trim() && t > 0 ? t : null });
    setName("");
    setDays("");
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Who or what to keep up with"
        className="h-9 min-w-0 flex-1 rounded-md border border-input bg-surface px-3 text-sm text-foreground outline-none placeholder:text-subtle focus:border-primary"
      />
      <input
        value={days}
        onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ""))}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="every N days"
        inputMode="numeric"
        className="h-9 w-32 rounded-md border border-input bg-surface px-3 text-sm text-foreground outline-none placeholder:text-subtle focus:border-primary"
      />
      <Button variant="secondary" size="sm" onClick={submit}>
        <AddIcon className="h-4 w-4" /> Add
      </Button>
    </div>
  );
}

export function CadencesPage() {
  const { data: trackers = [], isLoading } = useTrackers();
  const today = todayStr();
  const ordered = sortByUrgency(trackers, today);
  const dueCount = ordered.filter(
    (t) => cadenceStatus(t, today) === "due" || cadenceStatus(t, today) === "never"
  ).length;

  return (
    <div className="max-w-3xl pt-4 md:pt-6">
      <div className="mb-1 flex items-center gap-2">
        <CadenceIcon className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold tracking-tight text-foreground">Cadences</h1>
        {trackers.length > 0 && (
          <span className="text-xs text-subtle">
            {dueCount > 0 ? `${dueCount} needing attention` : "all fresh"}
          </span>
        )}
      </div>
      <p className="mb-4 text-sm text-subtle">
        Things measured by how long it has been, not by a deadline: people worth
        staying in touch with, plants, backups. Hit Log when you do it and the
        count restarts. A cadence is optional; without one a tracker just counts.
      </p>

      <AddCadence />

      {isLoading ? (
        <p className="text-sm text-subtle">Loading...</p>
      ) : ordered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-subtle">
            Nothing tracked yet. Add someone you keep meaning to call.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {ordered.map((t) => (
            <CadenceRow key={t.id} tracker={t} />
          ))}
        </div>
      )}
    </div>
  );
}
