import type { Priority } from "../../shared/types";

// Single source of truth for priority color. Mirrors the --pri-* CSS tokens in
// index.css. Import this anywhere a priority needs a color - task rows, cards,
// the drawer, and the calendar - so P3 (etc.) renders the SAME color everywhere
// instead of the old list-vs-calendar split.
export const PRIORITY_VAR: Record<Priority, string> = {
  1: "var(--pri-1)",
  2: "var(--pri-2)",
  3: "var(--pri-3)",
  4: "var(--pri-4)",
};

// Tailwind utility classes for the same scale, for class-based call sites.
export const PRIORITY_TEXT: Record<Priority, string> = {
  1: "text-pri-1",
  2: "text-pri-2",
  3: "text-pri-3",
  4: "text-pri-4",
};

// Semantic state colors (CSS vars), for inline styles.
export const STATE_VAR = {
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  primary: "var(--primary)",
} as const;

// Area accent palette. Each area stores its color as a key (e.g. "sky"); we map
// that to the --area-* CSS token here. Mirrors the tokens in index.css so the
// dot/ring/icon of an area render the same hue everywhere. Keys are stored in
// the DB; the hex lives only in the token layer.
export const AREA_COLORS: { key: string; var: string; label: string }[] = [
  { key: "indigo", var: "var(--area-indigo)", label: "Indigo" },
  { key: "sky", var: "var(--area-sky)", label: "Sky" },
  { key: "emerald", var: "var(--area-emerald)", label: "Emerald" },
  { key: "teal", var: "var(--area-teal)", label: "Teal" },
  { key: "amber", var: "var(--area-amber)", label: "Amber" },
  { key: "orange", var: "var(--area-orange)", label: "Orange" },
  { key: "rose", var: "var(--area-rose)", label: "Rose" },
  { key: "violet", var: "var(--area-violet)", label: "Violet" },
  { key: "cyan", var: "var(--area-cyan)", label: "Cyan" },
  { key: "green", var: "var(--area-green)", label: "Green" },
  { key: "slate", var: "var(--area-slate)", label: "Slate" },
];

// Resolve an area's stored color key to a CSS value. Falls back to the primary
// accent so an uncolored area still reads as "an area".
export function areaColorVar(key: string | null | undefined): string {
  if (!key) return "var(--primary)";
  return AREA_COLORS.find((c) => c.key === key)?.var ?? "var(--primary)";
}

// A faint, theme-aware wash of an area's colour for tinting the *background* of
// tasks that belong to it, so a mixed list (Today, board) reads at a glance by
// area. Transparent so it composes over hover/selection layers; returns
// `undefined` for an area with no colour so callers can skip the style entirely.
export function areaTintBg(
  key: string | null | undefined,
  pct = 8
): string | undefined {
  if (!key) return undefined;
  const v = AREA_COLORS.find((c) => c.key === key)?.var;
  if (!v) return undefined;
  return `color-mix(in oklab, ${v} ${pct}%, transparent)`;
}

// Priority pill palette: a light wash of the priority colour as background with
// the solid colour as text, so P1 (urgent) shouts and P3 stays legible in both
// themes. P4 (the default backlog level) is deliberately not pilled - see
// shouldPill.
export function priorityChip(p: Priority): { bg: string; fg: string } {
  const v = PRIORITY_VAR[p];
  return { bg: `color-mix(in oklab, ${v} 18%, transparent)`, fg: v };
}

// P4 is the level almost every task sits at, so pilling it everywhere is noise.
// Only 1-3 (an active decision to raise a task) get a visible pill.
export const shouldPill = (p: Priority | null | undefined): p is Priority =>
  p != null && p <= 3;
