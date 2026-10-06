"use client";

import { useEffect, useRef } from "react";
import { track } from "./analytics";

// Writing-session analytics. A "session" is a run of edits inside an editor pane
// with no gap longer than SESSION_IDLE_MS. Emits (counts only — never text):
//   writing_session_started  — first edit of a session
//   chapter_edited           — first edit to each chapter within a session
//   writing_session          — when the session ends (idle, or the tab closing)
//
// Sits beside the active-time tracker in app/write/page.tsx and uses the same
// definition of "writing" (an input inside a [data-paste-scope="center"] pane) and
// the same ≤60s gap rule for active time, so the two agree.

const SESSION_IDLE_MS = 5 * 60_000; // a longer pause ends the session
const ACTIVE_GAP_MS = 60_000; // gaps under this count as active writing time
const CHECK_INTERVAL_MS = 30_000;

type Session = {
  startedAt: number;
  lastInput: number;
  activeMs: number;
  startWords: number;
  startHour: number;
  chapters: Set<string>;
};

export function useWritingSessions(bookWordCount: number) {
  // Read at event time (not effect time) so the effect never re-subscribes on
  // every keystroke as the count changes.
  const words = useRef(bookWordCount);
  words.current = bookWordCount;

  useEffect(() => {
    let s: Session | null = null;

    function end(unloading = false) {
      if (!s) return;
      track(
        "writing_session",
        {
          active_seconds: Math.round(s.activeMs / 1000),
          duration_seconds: Math.round((s.lastInput - s.startedAt) / 1000),
          // Net change across the session — negative when the author cut more
          // than they wrote.
          words_delta: words.current - s.startWords,
          chapters_touched: s.chapters.size,
          book_words: words.current,
          start_hour: s.startHour,
        },
        { unloading }
      );
      s = null;
    }

    function onInput(e: Event) {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (!(t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      const pane = t.closest?.('[data-paste-scope="center"]');
      if (!pane) return;
      const now = Date.now();

      // A long pause (or a suspended/backgrounded tab) since the last edit means
      // the previous session already ended — close it out at its last edit.
      if (s && now - s.lastInput > SESSION_IDLE_MS) end();

      if (!s) {
        s = {
          startedAt: now,
          lastInput: now,
          activeMs: 0,
          // Captured before this edit lands: this listener is in the capture phase,
          // ahead of React's onInput that updates the store.
          startWords: words.current,
          startHour: new Date(now).getHours(),
          chapters: new Set(),
        };
        track("writing_session_started", { start_hour: s.startHour });
      } else {
        const gap = now - s.lastInput;
        if (gap <= ACTIVE_GAP_MS) s.activeMs += gap;
        s.lastInput = now;
      }

      // Book Info (synopsis) panes have no chapter id — they count as writing but
      // not as a chapter touched.
      const chapterId = pane.getAttribute("data-chapter-id");
      if (chapterId && !s.chapters.has(chapterId)) {
        s.chapters.add(chapterId);
        track("chapter_edited", { chapter_id: chapterId });
      }
    }

    function check() {
      if (s && Date.now() - s.lastInput > SESSION_IDLE_MS) end();
    }
    const onPageHide = () => end(true);

    document.addEventListener("input", onInput, true);
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("input", onInput, true);
      clearInterval(interval);
      window.removeEventListener("pagehide", onPageHide);
      end(true);
    };
  }, []);
}
