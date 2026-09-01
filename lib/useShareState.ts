"use client";

import { useCallback, useEffect, useState } from "react";
import type { ShareState } from "@/lib/shared/types";

// Shared client store for per-chapter share state. Two surfaces in the writer's
// right column need the same answer to "is this chapter shared?": the panel
// header (RightColumn), which only shows the Comments icon on a shared chapter,
// and the Sharing mini-menu (SharingMenu) in the footer. A module-level cache
// keyed by chapterId + a subscriber set keeps them in lockstep: sharing or
// stopping sharing from the menu updates the header live, with no reload and no
// second fetch. Mirrors lib/useUnread.ts.

const cache = new Map<string, ShareState>();
const listeners = new Set<() => void>();
const inflight = new Map<string, Promise<void>>();

function emit() {
  listeners.forEach((l) => l());
}

async function load(chapterId: string) {
  try {
    const res = await fetch(`/api/share?chapterId=${encodeURIComponent(chapterId)}`);
    if (!res.ok) return;
    cache.set(chapterId, (await res.json()) as ShareState);
    emit();
  } catch {
    // Leave any prior state; consumers fall back to "not shared".
  }
}

/** Force a refetch for one chapter; coalesces concurrent calls per chapter. */
export function refreshShareState(chapterId: string): Promise<void> {
  const pending = inflight.get(chapterId);
  if (pending) return pending;
  const p = load(chapterId).finally(() => inflight.delete(chapterId));
  inflight.set(chapterId, p);
  return p;
}

/** Publish a known state (e.g. after the menu shares / stops sharing / updates),
 *  so every subscriber re-renders without waiting on a fetch. */
export function publishShareState(state: ShareState) {
  cache.set(state.chapterId, state);
  emit();
}

export function useShareState(chapterId: string): ShareState & { refresh: () => void } {
  const [, force] = useState(0);

  useEffect(() => {
    const rerender = () => force((n) => n + 1);
    listeners.add(rerender);
    if (!cache.has(chapterId)) refreshShareState(chapterId);
    return () => {
      listeners.delete(rerender);
    };
  }, [chapterId]);

  // Stable per-chapter refresh so effects that depend on it don't re-fire every
  // render (which would loop: fetch → emit → rerender → fetch …).
  const refresh = useCallback(() => { refreshShareState(chapterId); }, [chapterId]);

  const state = cache.get(chapterId);
  return {
    chapterId,
    sharedChapterId: state?.sharedChapterId ?? null,
    shared: state?.shared ?? false,
    recipients: state?.recipients ?? [],
    stale: state?.stale ?? false,
    refresh,
  };
}
