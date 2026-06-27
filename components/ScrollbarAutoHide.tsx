"use client";

import { useEffect } from "react";

/**
 * Reveals scrollbars only while an element is actively being scrolled.
 * Adds `is-scrolling` to whatever element fired a scroll event and removes it
 * shortly after scrolling stops, so the bar fades back out (see globals.css).
 * Scroll events don't bubble, so we listen in the capture phase on document.
 */
export default function ScrollbarAutoHide() {
  useEffect(() => {
    const timers = new WeakMap<HTMLElement, number>();

    function onScroll(e: Event) {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      el.classList.add("is-scrolling");
      const prev = timers.get(el);
      if (prev) window.clearTimeout(prev);
      timers.set(
        el,
        window.setTimeout(() => el.classList.remove("is-scrolling"), 700)
      );
    }

    document.addEventListener("scroll", onScroll, true);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, []);

  return null;
}
