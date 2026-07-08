import { useEffect, useState, type ReactNode } from "react";
import {
  applyResolved,
  getStoredPref,
  resolvePref,
  storePref,
  systemResolved,
  ThemeContext,
  type Resolved,
  type ThemePref,
} from "../lib/theme";

// Owns the theme preference and keeps the DOM in sync. On mount it re-applies the
// stored pref (the index.html script already set it pre-paint; this reconciles
// React state with it) and, while on "system", follows OS appearance changes live.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(getStoredPref);
  const [resolved, setResolved] = useState<Resolved>(() => resolvePref(getStoredPref()));

  // Apply whenever the resolved mode changes.
  useEffect(() => {
    applyResolved(resolved);
  }, [resolved]);

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

  return (
    <ThemeContext.Provider value={{ pref, resolved, setPref }}>
      {children}
    </ThemeContext.Provider>
  );
}
