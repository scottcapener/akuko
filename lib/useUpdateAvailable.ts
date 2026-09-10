"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── Update detection ────────────────────────────────────────────────────────
// Tells an open /write tab when a newer build has been deployed, so the New
// Version card can invite a refresh. The tab's own version is frozen into the
// bundle at build time (NEXT_PUBLIC_APP_VERSION); the live value comes from
// /api/version, which runs on whatever deployment is currently serving. When
// they differ, a newer build is live.
//
// Polls politely: once on mount, whenever the tab becomes visible again, and on
// a slow interval WHILE visible (paused while hidden — no point polling a tab
// nobody's looking at, and browsers throttle background timers anyway).
//
// Backstop: if a lazily-loaded chunk fails (ChunkLoadError), the tab is provably
// stale — a deploy rotated the hashed asset filenames — so we surface the card
// even if the version poll hasn't caught up (or the version wasn't bumped).

const POLL_INTERVAL_MS = 5 * 60_000; // 5 minutes while visible
const CURRENT = process.env.NEXT_PUBLIC_APP_VERSION ?? null;

function isChunkLoadError(message: string): boolean {
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module/i.test(
    message
  );
}

export function useUpdateAvailable(onBeforeReload?: () => Promise<void> | void) {
  // Whether a newer build is out (drives the card) and, when known, its version
  // number for display. Availability is tracked separately from the number
  // because the ChunkLoadError backstop surfaces the card with no number in hand.
  // Set once, never cleared — the card doesn't retract itself.
  const [available, setAvailable] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const availableRef = useRef(false);
  const onBeforeReloadRef = useRef(onBeforeReload);
  onBeforeReloadRef.current = onBeforeReload;

  const surface = useCallback((v: string | null) => {
    if (availableRef.current) return; // already showing
    availableRef.current = true;
    setAvailable(true);
    if (v) setVersion(v);
  }, []);

  const check = useCallback(async () => {
    if (availableRef.current || !CURRENT) return; // already found, or no baseline to compare
    try {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data?.version === "string" && data.version !== CURRENT) {
        surface(data.version);
      }
    } catch {
      // Offline / transient — a later poll will catch it.
    }
  }, [surface]);

  useEffect(() => {
    check();

    let interval: ReturnType<typeof setInterval> | null = null;
    const startInterval = () => {
      if (interval == null) interval = setInterval(check, POLL_INTERVAL_MS);
    };
    const stopInterval = () => {
      if (interval != null) {
        clearInterval(interval);
        interval = null;
      }
    };
    if (document.visibilityState === "visible") startInterval();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        check();
        startInterval();
      } else {
        stopInterval();
      }
    };
    // A failed dynamic import proves the tab is stale — surface the card. We don't
    // have the live number here (the card just renders without one).
    const onError = (e: ErrorEvent) => {
      if (isChunkLoadError(e.message || "")) surface(null);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const message = typeof reason === "string" ? reason : reason?.message || reason?.name || "";
      if (isChunkLoadError(message)) surface(null);
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      stopInterval();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [check, surface]);

  const reloadNow = useCallback(async () => {
    // Best-effort: push pending saves to the server before reloading so the fresh
    // tab doesn't have to replay them from the durable queue. Never block the
    // reload on it — edits are already in IndexedDB and survive regardless.
    try {
      await onBeforeReloadRef.current?.();
    } catch {
      // ignore — reload anyway
    }
    window.location.reload();
  }, []);

  return { available, version, reloadNow };
}
