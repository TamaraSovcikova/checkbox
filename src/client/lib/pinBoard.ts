// The Cards page as a board: one column per place a card can live (#4).
//
// The first redesign kept one flat wall of cards with filter chips and a
// "Today · side column" dropdown on each card. At thirty cards that wall is
// unreadable, the chips only restate where cards live, and the dropdown asks two
// questions (which page, where on it) in one. A board answers "where does this
// live" by where the card IS, and moving it is dragging it.
//
// Pure: column building and the patch a drop produces, so both are testable.

import type { Area, Pin, Project } from "../../shared/types";
import { isLoose, scopeLabel, PIN_VIEWS, scopeForView, scopeForArea, scopeForProject } from "./pinScope";

export const LOOSE = "loose";

export type BoardColumn = { key: string; label: string; pins: Pin[] };

// The column a card sits in: Loose, or the page it is attached to.
export const columnOf = (p: Pin): string => (isLoose(p) ? LOOSE : p.scope || "today");

const byPosition = (a: Pin, b: Pin) =>
  a.position - b.position || a.created_at.localeCompare(b.created_at);

// Columns in a stable order: Loose, Today, the views, the areas in sidebar
// order, the projects, then anything unrecognised (a deleted area) so no card
// can vanish. Archived cards are on no column.
// Loose and Today always show, as the two places a new card usually goes;
// other places show when they hold a card or were opened with "Add a place".
export function boardColumns(
  pins: Pin[],
  areas: Area[],
  opened: string[] = [],
  projects: Project[] = []
): BoardColumn[] {
  const groups = new Map<string, Pin[]>();
  for (const p of pins) {
    if (p.archived_at) continue;
    const k = columnOf(p);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const wanted = new Set([LOOSE, "today", ...opened, ...groups.keys()]);
  const order = [
    LOOSE,
    "today",
    ...PIN_VIEWS.filter((v) => v !== "today").map(scopeForView),
    ...areas.map((a) => scopeForArea(a.id)),
    ...projects.map((p) => scopeForProject(p.id)),
  ];
  const keys = [
    ...order.filter((k) => wanted.has(k)),
    ...[...wanted].filter((k) => !order.includes(k)),
  ];
  return keys.map((key) => ({
    key,
    label: key === LOOSE ? "Loose" : scopeLabel(key, areas, projects),
    pins: [...(groups.get(key) ?? [])].sort(byPosition),
  }));
}

// Places not yet on the board, for the "Add a place" menu.
export function missingPlaces(columns: BoardColumn[], areas: Area[], projects: Project[] = []) {
  const shown = new Set(columns.map((c) => c.key));
  return [
    ...PIN_VIEWS.filter((v) => v !== "today").map((v) => ({
      key: scopeForView(v),
      label: v.charAt(0).toUpperCase() + v.slice(1),
    })),
    ...areas.map((a) => ({ key: scopeForArea(a.id), label: a.name })),
    ...projects
      .filter((p) => p.status === "active")
      .map((p) => ({ key: scopeForProject(p.id), label: p.name })),
  ].filter((o) => !shown.has(o.key));
}

// What to write when `pin` is dropped into column `target` at `index`, where
// `targetPins` is that column's cards in order WITHOUT the dragged one.
//
// Position lands between the neighbours (a fraction when needed), so a drop is
// one write rather than renumbering the column. Placement: dropping into Loose
// unpins; dropping a loose card onto a page puts it in the top strip, where it
// will be seen; a card already on a page keeps the spot it had.
export function dropPatch(
  pin: Pin,
  target: string,
  targetPins: Pin[],
  index: number
): Partial<Pin> {
  const i = Math.max(0, Math.min(index, targetPins.length));
  const prev = targetPins[i - 1];
  const next = targetPins[i];
  const position =
    prev && next
      ? (prev.position + next.position) / 2
      : prev
        ? prev.position + 1
        : next
          ? next.position - 1
          : 0;
  if (target === LOOSE) return { placement: "unpinned", position };
  return {
    scope: target,
    placement: isLoose(pin) ? "top" : pin.placement,
    position,
  };
}
