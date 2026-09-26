import type { Area, Pin, Project } from "../../shared/types";

// A pin's scope says which PAGE it belongs to; `placement` says where on that page.
// Stored as one string (see migration 0021):
//   'today' | 'view:<name>' | 'area:<id>'
// Anything unrecognised falls back to Today, so a pin can never go missing.

// The views a pin can be attached to. Logbook is deliberately absent: it is a
// history, not somewhere you keep a working list.
export const PIN_VIEWS = ["today", "upcoming", "overdue", "backlog", "snoozed"] as const;

export const scopeForView = (name: string) =>
  name === "today" ? "today" : `view:${name}`;
export const scopeForArea = (areaId: string) => `area:${areaId}`;
// Cards on a project page (#4).
export const scopeForProject = (projectId: string) => `project:${projectId}`;

// Archived cards are on no page (#4).
export function pinsForScope(pins: Pin[], scope: string): Pin[] {
  return pins.filter((p) => !p.archived_at && (p.scope || "today") === scope);
}

// Human label for a scope, for the Pins page grouping + the picker.
export function scopeLabel(scope: string, areas: Area[], projects: Project[] = []): string {
  const s = scope || "today";
  if (s === "today") return "Today";
  if (s.startsWith("view:")) {
    const n = s.slice(5);
    return n.charAt(0).toUpperCase() + n.slice(1);
  }
  if (s.startsWith("area:")) {
    const a = areas.find((x) => x.id === s.slice(5));
    // An area that has since been deleted: say so rather than showing a raw id.
    return a ? a.name : "Deleted area";
  }
  if (s.startsWith("project:")) {
    const p = projects.find((x) => x.id === s.slice(8));
    return p ? p.name : "Deleted project";
  }
  return "Today";
}

// Every scope a pin could be given, in picker order.
export function scopeOptions(areas: Area[]): { value: string; label: string }[] {
  return [
    ...PIN_VIEWS.map((v) => ({
      value: scopeForView(v),
      label: v.charAt(0).toUpperCase() + v.slice(1),
    })),
    ...areas.map((a) => ({ value: scopeForArea(a.id), label: a.name })),
  ];
}

// ── Where a pin shows, as ONE choice ─────────────────────────────────────────
//
// A pin has two stored fields, `scope` (which page) and `placement` (top/side/
// unpinned on it). Exposed separately they read as a puzzle: a "side" placement
// on a "today" scope, and an unpinned pin still carrying a meaningless scope.
// This collapses the pair into a single "Show on" choice (Nowhere, or a page
// with a spot) so the card offers one clear dropdown.
//
// A LOOSE pin is placement "unpinned": a list you keep without putting it on any
// page. Its scope is irrelevant, so it is not read.

export type PinSpot = { scope: string; placement: Pin["placement"] };

export const isLoose = (p: Pin): boolean => p.placement === "unpinned";

// Encode a scope+placement pair as one select value. "nowhere" is the loose case.
export function encodeSpot(scope: string, placement: Pin["placement"]): string {
  return placement === "unpinned" ? "nowhere" : `${placement}@${scope}`;
}

export function decodeSpot(value: string): PinSpot {
  if (value === "nowhere") return { scope: "today", placement: "unpinned" };
  const at = value.indexOf("@");
  const placement = value.slice(0, at) as Pin["placement"];
  return { scope: value.slice(at + 1), placement };
}

export const spotValueOf = (p: Pin): string =>
  isLoose(p) ? "nowhere" : encodeSpot(p.scope || "today", p.placement);

// One-line "where it shows" for a card chip: "Loose", or "Today · top strip".
export function spotLabel(p: Pin, areas: Area[]): string {
  if (isLoose(p)) return "Loose";
  const spot = p.placement === "top" ? "top strip" : "side column";
  return `${scopeLabel(p.scope || "today", areas)} · ${spot}`;
}

// The grouped options for the "Show on" dropdown: Nowhere first, then Today
// (top/side), then each area (top/side). Views are omitted here to keep the list
// short: a pin can still be scoped to a view via older data, and the label
// handles it, but the common homes are Today and areas.
export function spotOptions(
  areas: Area[]
): { group: string; options: { value: string; label: string }[] }[] {
  const page = (scope: string) => [
    { value: encodeSpot(scope, "top"), label: "Top strip" },
    { value: encodeSpot(scope, "side"), label: "Side column" },
  ];
  return [
    { group: "", options: [{ value: "nowhere", label: "Nowhere (just a list)" }] },
    { group: "Today", options: page("today") },
    ...areas.map((a) => ({ group: a.name, options: page(scopeForArea(a.id)) })),
  ];
}
