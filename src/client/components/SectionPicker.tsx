import { useState } from "react";
import type { Area, Project } from "../../shared/types";
import { areaColorVar } from "../lib/colors";
import { areaIcon } from "../lib/icons";
import { cn } from "@/lib/utils";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandEmpty,
} from "./ui/command";
import { ChevronDownIcon, CheckIcon } from "../lib/icons";

// Where a task lives, chosen from a SEARCHABLE list GROUPED BY AREA.
//
// It was a native <select> with two flat optgroups, Areas then Projects. Her
// words: "there is no grouping, its just a whole lot of projects and areas and
// it is hard to find the one i need". Both halves of that are real. A flat
// project list hides the one fact that would let you find a project fast (which
// area it belongs to), and a native select has no search, so a long list can
// only be scrolled.
//
// So: one filter box over everything, and each area is a heading with its own
// projects under it. Filing directly IN an area is the first row of that area's
// group rather than a separate list, because "Founder Path" and "Founder Path >
// Fundraising" are the same decision made at two depths, and splitting them into
// two lists is what made you look in two places.
//
// Projects with no area get their own group at the end; completed and archived
// projects are left out unless the task is already in one, since offering to
// file new work into a finished project is noise, and hiding where a task
// actually is would be a lie.
// Does this row match what was typed? Every whitespace-separated term has to
// appear in the row's text, so "career path" finds Career > Founder Path and
// "career" does not find "TeChnicAl fluency (R-035/036/037)".
//
// Replaces cmdk's default, which scores a fuzzy SUBSEQUENCE: it matched half the
// list on her real projects, which is worse than no search at all, because a
// list you cannot trust to have filtered is a list you have to read anyway.
export function matches(value: string, search: string): number {
  const hay = value.toLowerCase();
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((t) => hay.includes(t)) ? 1 : 0;
}

export function SectionPicker({
  areas,
  projects,
  areaId,
  projectId,
  onPick,
}: {
  areas: Area[];
  projects: Project[];
  areaId: string | null;
  projectId: string | null;
  // "" clears both (Backlog), "area:<id>" files in an area, "proj:<id>" in a project.
  onPick: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const live = projects.filter(
    (p) => p.status === "active" || p.id === projectId
  );
  const byArea = (id: string) =>
    live
      .filter((p) => p.area_id === id)
      .sort((a, b) => a.position - b.position);
  const orphans = live
    .filter((p) => p.area_id == null)
    .sort((a, b) => a.position - b.position);
  const sortedAreas = [...areas].sort((a, b) => a.position - b.position);

  // What the breadcrumb says now. A project shows "Area › Project" so the
  // trigger answers the same question the list is grouped by.
  const project = projects.find((p) => p.id === projectId);
  const area = areas.find((a) => a.id === (areaId ?? project?.area_id ?? null));
  const label = project
    ? `${area ? `${area.name} › ` : ""}${project.name}`
    : area
    ? area.name
    : "No section (Backlog)";

  function pick(value: string) {
    onPick(value);
    setOpen(false);
  }

  // One row, so an area and a project are the same shape at two depths.
  function Row({
    value,
    name,
    color,
    indent,
    selected,
    Icon,
    // The row's OWN area, so a project stays findable by the area it is in:
    // typing "career" surfaces everything under Career. Not the sheet's current
    // breadcrumb, which is a different task's answer entirely.
    areaName,
  }: {
    value: string;
    name: string;
    color: string | null;
    indent?: boolean;
    selected: boolean;
    Icon?: ReturnType<typeof areaIcon>;
    areaName?: string;
  }) {
    return (
      <CommandItem
        // What the filter matches against: the name, its area, and the id (so
        // two projects sharing a name still get distinct cmdk values).
        value={`${name} ${areaName ?? ""} ${value}`}
        onSelect={() => pick(value)}
        className={cn(indent && "pl-6")}
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: areaColorVar(color) }}
        />
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted" />}
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {selected && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-primary" />}
      </CommandItem>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Move this task"
          // Still a breadcrumb, not a labelled control: w-fit so the chevron
          // hugs the name instead of stretching to the sheet's edge.
          className="flex w-fit max-w-full items-center gap-1.5 rounded border border-transparent py-0.5 text-xs text-muted outline-none transition-colors hover:border-border hover:text-foreground focus:border-primary"
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: areaColorVar(area?.color) }}
          />
          <span className="truncate">{label}</span>
          <ChevronDownIcon className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command filter={matches}>
          <CommandInput placeholder="Search areas and projects…" />
          <CommandList>
            <CommandEmpty className="px-3 py-4 text-xs text-subtle">
              Nothing matches.
            </CommandEmpty>
            {sortedAreas.map((a) => {
              const Icon = areaIcon(a.icon);
              return (
                <CommandGroup key={a.id} heading={a.name}>
                  <Row
                    value={`area:${a.id}`}
                    name={a.name}
                    color={a.color}
                    Icon={Icon}
                    selected={areaId === a.id && !projectId}
                  />
                  {byArea(a.id).map((p) => (
                    <Row
                      key={p.id}
                      value={`proj:${p.id}`}
                      name={p.name}
                      color={a.color}
                      areaName={a.name}
                      indent
                      selected={projectId === p.id}
                    />
                  ))}
                </CommandGroup>
              );
            })}
            {orphans.length > 0 && (
              <CommandGroup heading="No area">
                {orphans.map((p) => (
                  <Row
                    key={p.id}
                    value={`proj:${p.id}`}
                    name={p.name}
                    color={null}
                    selected={projectId === p.id}
                  />
                ))}
              </CommandGroup>
            )}
            <CommandGroup>
              <Row
                value=""
                name="No section (Backlog)"
                color={null}
                selected={!areaId && !projectId}
              />
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
