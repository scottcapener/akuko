"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { ensureDevSession } from "@/lib/ensureDevSession";
import { latestUpdate } from "@/lib/updates";
import UpdateCard from "@/components/UpdateCard";

// ── What's New modal ──────────────────────────────────────────────────────────
// Mounted once on the writer. It self-gates: on first mount of the session it
// reads the caller's seen-cursor (profile.updates_seen_id) and shows the latest
// update only when that cursor is behind it — so a given update appears once,
// stays gone after dismissal, and returns for everyone when a newer one ships.
//
// Dismissal advances the cursor server-side (POST /api/updates/seen), which is
// why the reappearance is per-account, not per-device. The modal hides
// optimistically on close regardless of that write, so a failed sync can't turn
// into a nag within the session.
//
// Desktop: centered card. Mobile: a full-width drawer that rises from the bottom.
// Long content scrolls inside the card; a short card has no scrollbar.

function CloseIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

export default function WhatsNewModal() {
  const [open, setOpen] = useState(false);
  // Drives the enter transition (drawer rise / fade) — flipped on the frame after
  // the portal mounts so the browser animates from the off-screen start state.
  const [shown, setShown] = useState(false);
  const decided = useRef(false);

  // Decide whether to show, exactly once. The ref also guards against React
  // StrictMode's double-invoke in development.
  useEffect(() => {
    if (decided.current || !latestUpdate) return;
    decided.current = true;
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      try {
        await ensureDevSession(supabase);
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (cancelled || !user) return;
        const { data, error } = await supabase
          .from("profiles")
          .select("updates_seen_id")
          .eq("id", user.id)
          .single();
        // If the column isn't there yet (migration 016 not run), stay quiet
        // rather than risk a loop we can't clear.
        if (cancelled || error) return;
        if (data?.updates_seen_id !== latestUpdate.id) setOpen(true);
      } catch {
        /* Not signed in / offline — no announcement. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Kick the enter transition once the portal is in the DOM.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Esc closes, matching the Modal primitive.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function dismiss() {
    if (!latestUpdate) return;
    setOpen(false); // optimistic — never nag, even if the write below fails
    // Fire-and-forget; the cursor is best-effort and re-syncs next session.
    fetch("/api/updates/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: latestUpdate.id }),
    }).catch(() => {});
  }

  if (!open || !latestUpdate) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex justify-center bg-scrim transition-opacity duration-200 items-end md:items-center md:p-4 ${
        shown ? "opacity-100" : "opacity-0"
      }`}
      onClick={dismiss}
      role="dialog"
      aria-modal="true"
      aria-label="What's new"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative flex max-h-[90vh] w-full flex-col overflow-hidden bg-panel shadow-2xl transition-transform duration-200 ease-out rounded-t-2xl md:max-h-[85vh] md:max-w-md md:rounded-2xl ${
          shown ? "translate-y-0" : "translate-y-full md:translate-y-0"
        }`}
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          <UpdateCard
            update={latestUpdate}
            showNew
            action={
              <button
                onClick={dismiss}
                aria-label="Dismiss"
                className="-mr-1 -mt-1 flex-shrink-0 text-subtle transition-colors hover:text-text"
              >
                <CloseIcon />
              </button>
            }
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
