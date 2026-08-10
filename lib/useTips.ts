"use client";

import { useEffect, useState } from "react";
import { FALLBACK_TIPS } from "@/lib/tips";

// Client-side access to the ordered tip list via /api/tips (which keeps the
// Google Sheet URL server-side and caches it daily). Cached at module scope so a
// second consumer in the same session paints immediately without a refetch.
// Returns `null` until the first fetch resolves, then always a non-empty list.
let cache: string[] | null = null;

export function useTips(): string[] | null {
  const [tips, setTips] = useState<string[] | null>(cache);

  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tips");
        const data = await res.json();
        const list = Array.isArray(data?.tips) && data.tips.length ? data.tips : FALLBACK_TIPS;
        cache = list;
        if (!cancelled) setTips(list);
      } catch {
        cache = FALLBACK_TIPS;
        if (!cancelled) setTips(FALLBACK_TIPS);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return tips;
}
