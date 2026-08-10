"use client";

import { useEffect, useRef, useState } from "react";
import { useTips } from "@/lib/useTips";

// ── Tips card ("Tip of the day") ───────────────────────────────────────────────
// A small widget that floats over the book panel's chapter list. It appears once,
// at the start of the first writing session each day, showing the next tip in the
// list (basic → advanced). Tips are consumed in order and never repeat: once the
// whole list has been shown, the card stops appearing.
//
// All of its state is device-scoped localStorage, consistent with the other view
// preferences (scenes/links/theme). `hc.tipsEnabled` is the shared key the
// Settings "Tips" toggle writes.

const K = {
  enabled: "hc.tipsEnabled", // shared with the Settings toggle (JSON boolean)
  cursor: "hc.tipsCursor", // index of the next tip to show
  lastShown: "hc.tipsLastShownDate", // YYYY-MM-DD the card last appeared
  firstSeen: "hc.tipsFirstSeen", // has the card ever been shown (drives the CTA variant)
} as const;

// Local calendar day — a new value here is what triggers the once-a-day appearance.
function todayKey(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// URL of the full tips page. Opened in a new tab from "View all" (per spec, the
// How to Use Hot Cocoa page always opens in a new tab).
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
    // against React StrictMode's double-invoke in development advancing twice.
    if (decided.current || tips === null) return;
    decided.current = true;
    try {
      if (localStorage.getItem(K.enabled) === "false") return; // turned off (absent = on)

      const cursor = Number(localStorage.getItem(K.cursor) ?? "0") || 0;
      if (cursor >= tips.length) return; // every tip has been shown — stop appearing

      if (localStorage.getItem(K.lastShown) === todayKey()) return; // already shown today

      const firstTime = localStorage.getItem(K.firstSeen) !== "true";
      setCard({ text: tips[cursor], firstTime });

      // Consume this tip for the day: record the date and advance the cursor so
      // the next new day shows the next tip, whether or not this one is dismissed.
      localStorage.setItem(K.lastShown, todayKey());
      localStorage.setItem(K.cursor, String(cursor + 1));
      localStorage.setItem(K.firstSeen, "true");
    } catch {
      // localStorage unavailable — just don't show the card.
    }
  }, [tips]);

  if (!card) return null;

  const dismiss = () => setCard(null);
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
          <a
            href={HOW_TO_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={dismiss}
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
