import type { Priority } from "../../shared/types";

// Single source of truth for priority color. Mirrors the --pri-* CSS tokens in
// index.css. Import this anywhere a priority needs a color — task rows, cards,
// the drawer, and the calendar — so P3 (etc.) renders the SAME color everywhere
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
