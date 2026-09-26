// Set the theme before first paint so there is no dark->light flash. Mirrors
// lib/theme.ts: reads the stored pref, falls back to the OS setting, and writes
// data-theme + color-scheme + theme-color. ThemeProvider reconciles.
//
// A file rather than an inline <script>, so the Content-Security-Policy can
// allow scripts from 'self' only (#10). Loaded synchronously in <head>, so it
// still runs before the body paints.
(function () {
  try {
    var p = localStorage.getItem("checkbox-theme");
    var sysDark = matchMedia("(prefers-color-scheme: dark)").matches;
    var mode = p === "light" || p === "dark" ? p : sysDark ? "dark" : "light";
    var root = document.documentElement;
    root.dataset.theme = mode;
    root.style.colorScheme = mode;
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", mode === "light" ? "#faf9f6" : "#0b1120");
    // Colour scheme + font, same pre-paint trick (no flash). Absent values
    // fall back to the base indigo / sans via the CSS defaults.
    root.dataset.palette = localStorage.getItem("checkbox-palette") || "indigo";
    root.dataset.font = localStorage.getItem("checkbox-font") || "sans";
  } catch (e) {}
})();
