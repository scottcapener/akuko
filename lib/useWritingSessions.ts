"use client";

import { useEffect, useRef } from "react";
import { track } from "./analytics";
import { chapterWordCount, wordCountAll } from "./words";
import type { Section } from "./types";

// Writing-session analytics. A "session" is a run of edits inside an editor pane
// with no gap longer than SESSION_IDLE_MS. Emits (counts only — never text):
//   writing_session_started  — first edit of a session
//   chapter_edited           — first edit to each chapter within a session
//   writing_session          — when the session ends (idle, or the tab closing)
//
// words_delta is measured per chapter: each touched chapter's count at its first
// edit vs. at session end. NOT the whole book's count — chapters load lazily (and
// prefetch in the background), so the book total climbs as chapters arrive and a
// book-level diff counted every late-loading chapter as "written".
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
  startHour: number;
  // chapter id → its word count just before the session's first edit to it.
  chapters: Map<string, number>;
};

export function useWritingSessions(sections: Section[]) {
  // Read at event time (not effect time) so the effect never re-subscribes on
  // every keystroke as the content changes.
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;

  useEffect(() => {
    let s: Session | null = null;

    const chapterWords = (id: string) => {
      for (const sec of sectionsRef.current) {
        const ch = sec.chapters.find((c) => c.id === id);
        if (ch) return chapterWordCount(ch.scenes);
      }
      return 0;
    };

    function end(unloading = false) {
      if (!s) return;
      track(
        "writing_session",
        {
          active_seconds: Math.round(s.activeMs / 1000),
          duration_seconds: Math.round((s.lastInput - s.startedAt) / 1000),
          // Net change across the session's chapters — negative when the author
          // cut more than they wrote.
          words_delta: [...s.chapters].reduce((t, [id, start]) => t + chapterWords(id) - start, 0),
          chapters_touched: s.chapters.size,
          book_words: wordCountAll(sectionsRef.current),
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
          startHour: new Date(now).getHours(),
          chapters: new Map(),
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
        // Captured before this edit lands: this listener is in the capture phase,
        // ahead of React's onInput that updates the store.
        s.chapters.set(chapterId, chapterWords(chapterId));
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
