"use client";

import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "hc.theme";

/**
 * Reads/writes the app theme. The source of truth is the `data-theme`
 * attribute on <html> — the inline script in layout.tsx sets it pre-paint,
 * this hook keeps it and localStorage in sync afterward. Dark is the default
 * (no attribute); light is the only value ever written.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("dark");

  // Sync from the DOM after mount so we match whatever the pre-paint script set.
  useEffect(() => {
    setThemeState(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);

  function setTheme(next: Theme) {
    if (next === "light") {
      document.documentElement.dataset.theme = "light";
    } else {
      delete document.documentElement.dataset.theme;
    }
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
    setThemeState(next);
  }

  function toggleTheme() {
    setTheme(theme === "light" ? "dark" : "light");
  }

  return { theme, setTheme, toggleTheme };
}
