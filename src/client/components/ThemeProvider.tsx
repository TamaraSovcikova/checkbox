import { useEffect, useState, type ReactNode } from "react";
import {
  applyResolved,
  applyPalette,
  applyFont,
  getStoredPref,
  getStoredPalette,
  getStoredFont,
  resolvePref,
  storePref,
  storePalette,
  storeFont,
  systemResolved,
  ThemeContext,
  type Resolved,
  type ThemePref,
  type Palette,
  type FontChoice,
} from "../lib/theme";

// Owns the theme preference and keeps the DOM in sync. On mount it re-applies the
// stored pref (the index.html script already set it pre-paint; this reconciles
// React state with it) and, while on "system", follows OS appearance changes live.
// Palette (colour scheme) and font sit alongside the light/dark mode, each driven
// by its own documentElement data-attribute + CSS overrides.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(getStoredPref);
  const [resolved, setResolved] = useState<Resolved>(() => resolvePref(getStoredPref()));
  const [palette, setPaletteState] = useState<Palette>(getStoredPalette);
  const [font, setFontState] = useState<FontChoice>(getStoredFont);

  // Apply whenever the resolved mode changes.
  useEffect(() => {
    applyResolved(resolved);
  }, [resolved]);

  // Keep the palette + font attributes in sync (also reconciles the pre-paint
  // values set by index.html).
  useEffect(() => {
    applyPalette(palette);
  }, [palette]);
  useEffect(() => {
    applyFont(font);
  }, [font]);

  // Follow the OS only while the user is on "system".
  useEffect(() => {
    if (pref !== "system") {
      setResolved(pref);
      return;
    }
    setResolved(systemResolved());
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(systemResolved());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  const setPref = (p: ThemePref) => {
    storePref(p);
    setPrefState(p);
  };
  const setPalette = (p: Palette) => {
    storePalette(p);
    setPaletteState(p);
  };
  const setFont = (f: FontChoice) => {
    storeFont(f);
    setFontState(f);
  };

  return (
    <ThemeContext.Provider
      value={{ pref, resolved, setPref, palette, setPalette, font, setFont }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
