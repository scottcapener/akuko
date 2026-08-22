"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Single-editor coordination across tabs. Two tabs open on the same book both run
// independent autosave loops from independent base versions, so alternating edits
// between them produce a stream of save conflicts (and, if the wrong side of the
// conflict modal is picked, silent data loss). This hook makes one tab the *owner*
// per book — the only tab allowed to edit — and parks the rest read-only until the
// author explicitly takes over here.
//
// The Web Locks API is the source of truth: an exclusive lock named per book that
// the owner holds for its lifetime. It survives crashes and tab closes (the lock
// auto-releases, and the next waiter is granted it), which a hand-rolled heartbeat
// wouldn't. BroadcastChannel carries only the takeover request. Where Web Locks is
// unavailable (older Safari) the hook degrades to "always owner" rather than
// blocking the sole editing path — a rare double-write stays last-write-wins.

type OwnershipStatus = "acquiring" | "owner" | "readonly";

const CHANNEL = "hotcocoa-editor-ownership";

interface LockInfoLike {
  name?: string;
}
interface LockSnapshotLike {
  held?: LockInfoLike[];
}

export function useEditorOwnership(bookId: string | undefined) {
  const [status, setStatus] = useState<OwnershipStatus>("acquiring");
  // Broadcast + book id kept in refs so the stable `takeOver` callback always
  // targets the current book without re-subscribing the channel.
  const bcRef = useRef<BroadcastChannel | null>(null);
  const bookRef = useRef(bookId);
  bookRef.current = bookId;

  // Ask the current owner to hand the lock over. This tab is already queued behind
  // it (it's read-only), so it wins the lock the moment the owner releases.
  const takeOver = useCallback(() => {
    const id = bookRef.current;
    if (id) bcRef.current?.postMessage({ type: "yield", bookId: id });
  }, []);

  useEffect(() => {
    if (!bookId) return;
    const locks = (navigator as unknown as { locks?: LockManager }).locks;
    // No Web Locks → can't arbitrate; never block the only editable tab.
    if (!locks?.request) {
      setStatus("owner");
      return;
    }

    const name = `hotcocoa-editor:${bookId}`;
    const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;
    bcRef.current = bc;

    let disposed = false;
    const ctrl = new AbortController();
    // Set while this tab holds the lock; calling it releases the lock (the request
    // callback's promise resolves), so the next queued tab is granted ownership.
    const release = { current: null as null | (() => void) };
    const hold = () => new Promise<void>((resolve) => { release.current = resolve; });

    // Re-acquire in a loop: hold the lock as owner, and when we yield it (takeover)
    // fall back into the queue as read-only so we can reclaim it later.
    (async function acquireLoop() {
      let first = true;
      while (!disposed) {
        let owned = false;
        let req: Promise<unknown>;
        try {
          req = locks.request(name, { signal: ctrl.signal }, async () => {
            owned = true;
            if (!disposed) setStatus("owner");
            await hold(); // held until release.current() runs (takeover / unmount)
            owned = false;
            release.current = null;
          });
        } catch {
          return; // signal already aborted
        }

        if (first) {
          first = false;
          // First pass: only show read-only once we can confirm another tab holds
          // the lock — otherwise the sole/owning tab would flash the overlay in the
          // gap before its own grant lands.
          try {
            const q = (await locks.query()) as LockSnapshotLike;
            if (!owned && !disposed && q.held?.some((l) => l.name === name)) {
              setStatus("readonly");
            }
          } catch {
            /* query unsupported — leave as acquiring until the grant lands */
          }
        } else if (!owned && !disposed) {
          // After a yield another tab is taking over, so we're read-only until our
          // re-queued request is granted again.
          setStatus("readonly");
        }

        try {
          await req; // resolves after we owned and released, or rejects on abort
        } catch {
          return; // aborted on unmount
        }
      }
    })();

    // As owner, honor another tab's takeover request by releasing the lock.
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "yield" && e.data.bookId === bookId) release.current?.();
    };
    bc?.addEventListener("message", onMessage);

    return () => {
      disposed = true;
      release.current?.(); // release a held lock so another tab can take over
      ctrl.abort(); // abort a pending (read-only) queue wait
      bc?.removeEventListener("message", onMessage);
      bc?.close();
      bcRef.current = null;
    };
  }, [bookId]);

  return { status, isOwner: status === "owner", takeOver };
}
