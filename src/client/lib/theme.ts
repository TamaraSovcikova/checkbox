import { createContext, useContext } from "react";

// Theme = what the user picked; Resolved = what's actually applied to the DOM.
// "system" follows the OS via matchMedia; the resolver collapses it to a concrete
// mode. The chosen preference persists in localStorage under THEME_KEY. The whole
// color system keys off documentElement[data-theme]; see index.css for the tokens
// and index.html for the pre-paint script that sets the attribute before React
// mounts (no flash). Keep those three in sync.
export type ThemePref = "system" | "light" | "dark";
export type Resolved = "light" | "dark";

// A colour scheme, orthogonal to light/dark: it recolours the accent (primary,
// ring, focus, active states) while the light/dark mode still owns the surfaces.
// Keys map to the [data-palette] overrides in index.css. "indigo" is the base
// (no override block). `swatch` is the representative dot shown in the picker.
export type Palette =
  | "indigo"
  | "ocean"
  | "emerald"
  | "teal"
  | "violet"
  | "rose"
  | "amber"
  | "crimson"
  | "graphite";

export type FontChoice = "sans" | "serif" | "rounded" | "mono";

export const THEME_KEY = "checkbox-theme";
export const PALETTE_KEY = "checkbox-palette";
export const FONT_KEY = "checkbox-font";

export const PALETTES: { key: Palette; label: string; swatch: string }[] = [
  { key: "indigo", label: "Indigo", swatch: "#6366f1" },
  { key: "ocean", label: "Ocean", swatch: "#0ea5e9" },
  { key: "emerald", label: "Emerald", swatch: "#10b981" },
  { key: "teal", label: "Teal", swatch: "#14b8a6" },
  { key: "violet", label: "Violet", swatch: "#8b5cf6" },
  { key: "rose", label: "Rose", swatch: "#f43f5e" },
  { key: "amber", label: "Amber", swatch: "#f59e0b" },
  { key: "crimson", label: "Crimson", swatch: "#ef4444" },
  { key: "graphite", label: "Graphite", swatch: "#64748b" },
];

export const FONTS: { key: FontChoice; label: string }[] = [
  { key: "sans", label: "Sans" },
  { key: "serif", label: "Serif" },
  { key: "rounded", label: "Rounded" },
  { key: "mono", label: "Mono" },
];

const PALETTE_KEYS = new Set<string>(PALETTES.map((p) => p.key));
const FONT_KEYS = new Set<string>(FONTS.map((f) => f.key));

// Browser-chrome color per mode: matches --background so the mobile URL bar /
// status bar blends with the app. Mirrors the light/dark --background tokens.
const THEME_COLOR: Record<Resolved, string> = {
  dark: "#0b1120",
  light: "#faf9f6",
};

export function getStoredPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // localStorage can throw in private mode; fall through to the default.
  }
  return "system";
}

export function systemResolved(): Resolved {
  return typeof matchMedia === "function" &&
    matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function resolvePref(pref: ThemePref): Resolved {
  return pref === "system" ? systemResolved() : pref;
}

// Apply a resolved mode to the document: the data-theme attribute (drives the CSS
// tokens), color-scheme (native form controls / scrollbars), and the theme-color
// meta (browser chrome). Called by the provider on mount and on every change.
export function applyResolved(resolved: Resolved): void {
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[resolved]);
}

export function storePref(pref: ThemePref): void {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    // ignore: a non-persisted choice still applies for this session.
  }
}

// ── Palette + font (both persist to localStorage, per-device like the mode) ────

export function getStoredPalette(): Palette {
  try {
    const v = localStorage.getItem(PALETTE_KEY);
    if (v && PALETTE_KEYS.has(v)) return v as Palette;
  } catch {
    // fall through
  }
  return "indigo";
}

export function getStoredFont(): FontChoice {
  try {
    const v = localStorage.getItem(FONT_KEY);
    if (v && FONT_KEYS.has(v)) return v as FontChoice;
  } catch {
    // fall through
  }
  return "sans";
}

// Both drive CSS variable overrides keyed off documentElement[data-palette] /
// [data-font], see index.css. index.html sets them pre-paint (no flash).
export function applyPalette(p: Palette): void {
  document.documentElement.dataset.palette = p;
}

export function applyFont(f: FontChoice): void {
  document.documentElement.dataset.font = f;
}

export function storePalette(p: Palette): void {
  try {
    localStorage.setItem(PALETTE_KEY, p);
  } catch {
    // ignore
  }
}

export function storeFont(f: FontChoice): void {
  try {
    localStorage.setItem(FONT_KEY, f);
  } catch {
    // ignore
  }
}

export type ThemeCtx = {
  pref: ThemePref;
  resolved: Resolved;
  setPref: (p: ThemePref) => void;
  palette: Palette;
  setPalette: (p: Palette) => void;
  font: FontChoice;
  setFont: (f: FontChoice) => void;
};

export const ThemeContext = createContext<ThemeCtx>({
  pref: "system",
  resolved: "dark",
  setPref: () => {},
  palette: "indigo",
  setPalette: () => {},
  font: "sans",
  setFont: () => {},
});

export const useTheme = () => useContext(ThemeContext);
