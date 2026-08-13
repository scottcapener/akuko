"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ensureDevSession } from "@/lib/ensureDevSession";
import type { UnreadState } from "@/lib/shared/unread";

// Shared client store for unread state (SHARED_WITH_YOU.md §6). One /api/shared/
// unread fetch feeds every badge — the account-menu "Shared" row, the collapsed
// panel dots, and the editor Comments-tab count — across the workspace nav AND
// the writer, which are separate React trees. A module-level cache + subscriber
// set dedupes the fetch and lets any surface trigger a refresh (e.g. after the
// read view or Comments tab marks a chapter seen), so all badges update together.

let cache: UnreadState | null = null;
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

async function load() {
  const supabase = createClient();
  await ensureDevSession(supabase); // dev: make sure the API sees a session
  const res = await fetch("/api/shared/unread");
  if (!res.ok) return;
  cache = (await res.json()) as UnreadState;
  listeners.forEach((l) => l());
}

/** Force a refetch; safe to call from anywhere. Coalesces concurrent calls. */
export function refreshUnread(): Promise<void> {
  if (!inflight) inflight = load().finally(() => { inflight = null; });
  return inflight;
}

export function useUnread(): UnreadState & { refresh: () => void } {
  const [, force] = useState(0);

  useEffect(() => {
    const rerender = () => force((n) => n + 1);
    listeners.add(rerender);
    if (cache === null) refreshUnread(); // first mount of the session
    // Returning to the tab may reveal activity that happened elsewhere.
    const onVisible = () => { if (document.visibilityState === "visible") refreshUnread(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      listeners.delete(rerender);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const refresh = useCallback(() => { refreshUnread(); }, []);
  return { total: cache?.total ?? 0, chapters: cache?.chapters ?? [], refresh };
}
