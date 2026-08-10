"use client";

import { useRef, useState, useEffect } from "react";

// User-level view preferences (grid/list per section, scene visibility, panel
// collapse). These are display-only and never touch book structure, so they live
// in localStorage rather than the DB. The read happens after mount to avoid a
// hydration mismatch, so the initial render always uses `initial`.
//
// Shared by the writer (app/write/page.tsx) and the Workspace pages so a
// preference set in one place (e.g. Show scenes on the Settings page) is picked
// up by the other on its next mount — both read/write the same key.
export function useLocalStorageState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const loaded = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) setValue(JSON.parse(raw) as T);
    } catch {}
    loaded.current = true;
  }, [key]);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);
  return [value, setValue] as const;
}
