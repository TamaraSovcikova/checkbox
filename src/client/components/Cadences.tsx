import { useState } from "react";
import type { Tracker } from "../../shared/types";
import {
  useTrackers,
  useCreateTracker,
  useUpdateTracker,
  useViewPrefs,
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
import { emittedTaskTitle } from "../../shared/tracker";
import { areaColorVar } from "../lib/colors";
import { cn, todayStr } from "@/lib/utils";
import { groupBySection, sectionNames } from "../../shared/cadenceSections";
import { Button } from "./ui/button";
import { PageIntro } from "./PageIntro";
import { AddIcon, TrashIcon, CadenceIcon } from "../lib/icons";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
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

// Logging an occurrence, with the undo attached. Shared by the page's row and
// the pin's strip so the two cannot drift into different behaviours: the pin is
// a second place to press Log, not a second definition of what Log means.
export function useLogWithUndo() {
  const log = useLogTracker();
  const unlog = useUnlogTracker();
  const { toast } = useToast();
  return async (tracker: Tracker, occurredAt?: string) => {
    const res = await log.mutateAsync({ id: tracker.id, occurred_at: occurredAt });
    // Undo removes the exact row just written, so a double log followed by an
    // undo cannot delete the wrong one.
    toast(`Logged ${tracker.name}`, () =>
      unlog.mutate({ id: tracker.id, eventId: res.event_id })
    );
  };
}

function CadenceRow({
  tracker,
  sections = [],
  onNewSection = () => {},
}: {
  tracker: Tracker;
  // Every section name in play, and a way to register a brand new one, so the
  // row's move menu offers exactly what the page renders.
  sections?: string[];
  onNewSection?: (name: string) => void;
}) {
  const today = todayStr();
  const update = useUpdateTracker();
  const del = useDeleteTracker();
  const { data: areas = [] } = useAreas();
  const area = areas.find((a) => a.id === tracker.area_id);
  const logWithUndo = useLogWithUndo();

  const status = cadenceStatus(tracker, today);
  const since = daysSince(tracker, today);

  const onLog = (occurredAt?: string) => logWithUndo(tracker, occurredAt);

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
            {/* Only once it is actually emitting: a task title on a tracker that
                makes no tasks is a setting with nothing to act on. */}
            {tracker.auto_task && (
              <DropdownMenuItem
                onSelect={() => {
                  const raw = window.prompt(
                    `What should the task be called?\n\n{name} becomes "${tracker.name}", so it keeps up if you rename the tracker.\nBlank uses the name on its own.`,
                    tracker.task_title ?? "Call {name}"
                  );
                  if (raw === null) return;
                  update.mutate({
                    id: tracker.id,
                    body: { task_title: raw.trim() || null },
                  });
                }}
              >
                Task title...
              </DropdownMenuItem>
            )}
            {/* Move between sections. The list is the page's own order, so the
                menu and the headings always agree; "New section..." names one
                and moves this tracker into it in the same step (a section with
                no members is created from the page header instead). */}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Section</DropdownMenuLabel>
            {sections.map((name) => (
              <DropdownMenuCheckboxItem
                key={name}
                checked={tracker.section === name}
                onCheckedChange={() =>
                  update.mutate({
                    id: tracker.id,
                    body: { section: tracker.section === name ? null : name },
                  })
                }
              >
                {name}
              </DropdownMenuCheckboxItem>
            ))}
            {tracker.section && (
              <DropdownMenuItem
                onSelect={() => update.mutate({ id: tracker.id, body: { section: null } })}
              >
                Remove from section
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={() => {
                const raw = window.prompt("New section name");
                const name = raw?.trim();
                if (!name) return;
                onNewSection(name);
                update.mutate({ id: tracker.id, body: { section: name } });
              }}
            >
              New section...
            </DropdownMenuItem>
            <DropdownMenuSeparator />
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
        {/* Whether going past the cadence puts a TASK CARD on Today, as a
            switch you click, on the tracker's face. Her ask, and the setting it
            drives is the one that already existed: it was a line inside the
            three-dot menu, so the answer to "does this one make me a task or
            not" cost a menu open per tracker, and turning it on or off cost the
            same again.

            Only offered where it can mean something: with no target nothing is
            ever past due, so there is nothing to emit on. On, it names the task
            it will create (the RESOLVED title, so you see what you actually
            get); off, it is a dashed outline of the same thing. */}
        {tracker.target_days != null && (
          <button
            type="button"
            onClick={() =>
              update.mutate({
                id: tracker.id,
                body: { auto_task: !tracker.auto_task },
              })
            }
            title={
              tracker.auto_task
                ? `Makes a task called "${emittedTaskTitle(tracker)}" on your Today page when this goes past its cadence. Click to stop.`
                : "Click to make a task on your Today page when this goes past its cadence."
            }
            className={cn(
              "inline-flex max-w-[10rem] shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
              tracker.auto_task
                ? "border-primary bg-primary/10 text-primary"
                : "border-dashed border-input text-subtle hover:border-primary/50 hover:text-foreground"
            )}
          >
            <span className="truncate">
              {tracker.auto_task ? `→ ${emittedTaskTitle(tracker)}` : "no task"}
            </span>
          </button>
        )}
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

// The compact form, for a pin. Reads the trackers live and orders them by
// urgency, so the card carries no state of its own and can never go stale: there
// is nothing stored to keep in sync with the tracker list.
//
// `areaId` narrows it, which is what an area-scoped pin wants: a cadence card on
// Relationships & Identity should show the people, not the boiler service.
export function CadenceStrip({
  areaId,
  limit = 5,
}: {
  areaId?: string | null;
  limit?: number;
}) {
  const { data: all = [], isLoading } = useTrackers();
  const today = todayStr();
  const logWithUndo = useLogWithUndo();

  const scoped = areaId ? all.filter((t) => t.area_id === areaId) : all;
  const ordered = sortByUrgency(scoped, today).slice(0, limit);
  const hidden = scoped.length - ordered.length;

  if (isLoading) return <p className="text-[11px] text-subtle">Loading...</p>;
  if (scoped.length === 0) {
    return (
      <p className="text-[11px] text-subtle">
        Nothing tracked here yet. Add one on the Cadences page.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {ordered.map((t) => {
        const status = cadenceStatus(t, today);
        return (
          <div key={t.id} className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                  {t.name}
                </span>
                <span
                  className="shrink-0 text-[11px] tabular-nums"
                  style={{ color: STATUS_COLOR[status] }}
                >
                  {sinceLabel(t, today)}
                </span>
              </div>
              <div className="mt-1">
                <CadenceBar tracker={t} today={today} />
              </div>
            </div>
            <button
              type="button"
              onClick={() => logWithUndo(t)}
              title={`Log ${t.name} now`}
              className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              Log
            </button>
          </div>
        );
      })}
      {/* Say what is being held back rather than silently truncating: a card that
          quietly hides half your trackers is how a filter becomes a bug report. */}
      {hidden > 0 && (
        <p className="pt-0.5 text-[11px] text-subtle">
          +{hidden} more on the Cadences page
        </p>
      )}
    </div>
  );
}

export function CadencesPage() {
  const { data: trackers = [], isLoading } = useTrackers();
  const { cadenceSections, setCadenceSections } = useViewPrefs();
  const update = useUpdateTracker();
  const today = todayStr();
  const ordered = sortByUrgency(trackers, today);
  // Membership from the trackers, order from prefs, unioned so a section that
  // exists only on the data still renders (see shared/cadenceSections).
  const groups = groupBySection(ordered, cadenceSections);
  const names = sectionNames(ordered, cadenceSections);
  const registerSection = (name: string) => {
    if (!cadenceSections.includes(name)) setCadenceSections([...cadenceSections, name]);
  };
  const renameSection = (from: string) => {
    const raw = window.prompt(`Rename "${from}" to`, from);
    const to = raw?.trim();
    if (!to || to === from) return;
    // Membership is a NAME on each row, so a rename is a rename of every row
    // carrying it, plus the registry entry in place (keeping the order).
    trackers
      .filter((t) => t.section === from)
      .forEach((t) => update.mutate({ id: t.id, body: { section: to } }));
    setCadenceSections(
      cadenceSections.includes(from)
        ? cadenceSections.map((n) => (n === from ? to : n))
        : [...cadenceSections, to]
    );
  };
  const dissolveSection = (name: string, count: number) => {
    if (
      count > 0 &&
      !window.confirm(
        `Remove the "${name}" section? Its ${count} cadence${count === 1 ? "" : "s"} move back to ungrouped, nothing is deleted.`
      )
    )
      return;
    trackers
      .filter((t) => t.section === name)
      .forEach((t) => update.mutate({ id: t.id, body: { section: null } }));
    setCadenceSections(cadenceSections.filter((n) => n !== name));
  };
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
      <PageIntro id="cadences">
        Things measured by how long it has been, not by a deadline: people worth
        staying in touch with, plants, backups. Hit Log when you do it and the
        count restarts. A cadence is optional; without one a tracker just counts.
      </PageIntro>

      <AddCadence />

      <div className="mb-3">
        <button
          type="button"
          onClick={() => {
            const raw = window.prompt("New section name");
            const name = raw?.trim();
            if (name) registerSection(name);
          }}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-subtle transition-colors hover:text-foreground"
        >
          <AddIcon className="h-3.5 w-3.5" /> New section
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-subtle">Loading...</p>
      ) : ordered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-subtle">
            Nothing tracked yet. Add someone you keep meaning to call.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g: { name: string | null; items: Tracker[] }) => (
            <section key={g.name ?? "__ungrouped"}>
              {/* Ungrouped needs a heading only when there is something to
                  contrast it with; a flat list should look flat. */}
              {(g.name != null || groups.length > 1) && (
                <div className="mb-1.5 flex items-center gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">
                    {g.name ?? "Ungrouped"}
                  </h2>
                  <span className="text-[11px] tabular-nums text-subtle">
                    {g.items.length}
                  </span>
                  {g.name != null && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Section ${g.name} options`}
                          className="grid h-5 w-5 place-items-center rounded text-subtle transition-colors hover:bg-surface-2 hover:text-foreground"
                        >
                          ···
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onSelect={() => renameSection(g.name!)}>
                          Rename section
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => dissolveSection(g.name!, g.items.length)}
                        >
                          Remove section
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              )}
              {g.items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-subtle">
                  Empty. Move a cadence here from its ··· menu.
                </p>
              ) : (
                <div className="space-y-2">
                  {g.items.map((t: Tracker) => (
                    <CadenceRow
                      key={t.id}
                      tracker={t}
                      sections={names}
                      onNewSection={registerSection}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
