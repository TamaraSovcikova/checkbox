import { createContext, useContext } from "react";

// Theme = what the user picked; Resolved = what's actually applied to the DOM.
// "system" follows the OS via matchMedia; the resolver collapses it to a concrete
// mode. The chosen preference persists in localStorage under THEME_KEY. The whole
// color system keys off documentElement[data-theme]; see index.css for the tokens
// and index.html for the pre-paint script that sets the attribute before React
// mounts (no flash). Keep those three in sync.
export type ThemePref = "system" | "light" | "dark";
export type Resolved = "light" | "dark";

export const THEME_KEY = "checkbox-theme";

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
    // ignore — a non-persisted choice still applies for this session.
  }
}

export type ThemeCtx = {
  pref: ThemePref;
  resolved: Resolved;
  setPref: (p: ThemePref) => void;
};

export const ThemeContext = createContext<ThemeCtx>({
  pref: "system",
  resolved: "dark",
  setPref: () => {},
});

export const useTheme = () => useContext(ThemeContext);
