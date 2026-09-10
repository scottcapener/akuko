"use client";

import { useEffect, useRef, useState } from "react";
import { useTips } from "@/lib/useTips";

// ── Tips card ("Tip of the day") ───────────────────────────────────────────────
// A small widget that floats over the book panel's chapter list, showing the next
// tip in the list (basic → advanced). The current tip stays put — across reloads
// and sessions — until the reader dismisses it with the ×; dismissing advances to
// the next tip, which surfaces on the next load. Tips never repeat: once the whole
// list has been dismissed, the card stops appearing.
//
// All of its state is device-scoped localStorage, consistent with the other view
// preferences (scenes/links/theme). `hc.tipsEnabled` is the shared key the
// Settings "Tips" toggle writes.

const K = {
  enabled: "hc.tipsEnabled", // shared with the Settings toggle (JSON boolean)
  cursor: "hc.tipsCursor", // index of the tip currently shown / to show next
  firstSeen: "hc.tipsFirstSeen", // has the card ever been shown (drives the CTA variant)
} as const;

// URL of the full tips page, opened from "View all". Navigates in place rather
// than in a new tab — the How to Use page lives in the Workspace group and carries
// its own nav panel to get back.
const HOW_TO_URL = "/how-to";

function CloseIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

export default function TipsCard() {
  const tips = useTips();
  // Non-null once we've decided to show the card this session.
  const [card, setCard] = useState<{ text: string; firstTime: boolean } | null>(null);
  const decided = useRef(false);

  useEffect(() => {
    // Decide exactly once, after the tip list has loaded. The ref also guards
    // against React StrictMode's double-invoke in development.
    if (decided.current || tips === null) return;
    decided.current = true;
    try {
      if (localStorage.getItem(K.enabled) === "false") return; // turned off (absent = on)

      const cursor = Number(localStorage.getItem(K.cursor) ?? "0") || 0;
      if (cursor >= tips.length) return; // every tip has been dismissed — stop appearing

      const firstTime = localStorage.getItem(K.firstSeen) !== "true";
      setCard({ text: tips[cursor], firstTime });
      // Showing doesn't consume the tip — it stays until dismissed. Just record
      // that the card has been seen once, to fold away the first-run CTA.
      localStorage.setItem(K.firstSeen, "true");
    } catch {
      // localStorage unavailable — just don't show the card.
    }
  }, [tips]);

  if (!card) return null;

  // Manual dismiss (×) — advance to the next tip so it surfaces on the next load,
  // and hide for now (the current session doesn't roll straight into the next one).
  const dismiss = () => {
    try {
      const cursor = Number(localStorage.getItem(K.cursor) ?? "0") || 0;
      localStorage.setItem(K.cursor, String(cursor + 1));
    } catch {}
    setCard(null);
  };
  const turnOff = () => {
    try {
      localStorage.setItem(K.enabled, "false");
    } catch {}
    setCard(null);
  };

  return (
    <div className="pointer-events-auto rounded-xl border border-border-subtle bg-elevated p-3 shadow-lg">
      {/* Header — label + dismiss */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-subtle">
          Tip of the day
        </span>
        <button
          onClick={dismiss}
          className="-mt-0.5 -mr-0.5 flex-shrink-0 text-subtle transition-colors hover:text-text"
          aria-label="Dismiss tip"
          title="Dismiss"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Tip copy */}
      <p className="mt-1.5 text-xs leading-relaxed text-muted">{card.text}</p>

      {/* First-time only — a way to see them all or to turn the feature off. */}
      {card.firstTime && (
        <div className="mt-3 flex items-center gap-2">
          {/* Navigates in place (unmounts the card); leaves the current tip in
              place — only × advances it — so it's still here on return. */}
          <a
            href={HOW_TO_URL}
            className="flex-1 rounded-lg bg-hover py-1.5 text-center text-xs text-muted transition-colors hover:text-text"
          >
            View all
          </a>
          <button
            onClick={turnOff}
            className="flex-1 rounded-lg bg-hover py-1.5 text-center text-xs text-muted transition-colors hover:text-text"
          >
            Turn off
          </button>
        </div>
      )}
    </div>
  );
}
