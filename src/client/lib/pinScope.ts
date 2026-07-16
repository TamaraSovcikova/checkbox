import type { Area, Pin } from "../../shared/types";

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

export function pinsForScope(pins: Pin[], scope: string): Pin[] {
  return pins.filter((p) => (p.scope || "today") === scope);
}

// Human label for a scope, for the Pins page grouping + the picker.
export function scopeLabel(scope: string, areas: Area[]): string {
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
