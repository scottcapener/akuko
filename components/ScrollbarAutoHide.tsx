"use client";

import { useEffect } from "react";

/**
 * Reveals scrollbars only while an element is actively being scrolled
 * (`is-scrolling`) or, for `.hc-scroll-hoverbar` areas, while hovered (`:hover`,
 * see globals.css), then hides them again.
 *
 * Blink repaints `::-webkit-scrollbar` pseudo-elements lazily — essentially only
 * when the bar itself is hit — so a `:hover`/`.is-scrolling` change doesn't
 * reliably show or hide the thumb unless the pointer happens to cross the bar.
 * We force a repaint at each transition: when the pointer enters or leaves a
 * hover-reveal area, and when `is-scrolling` is removed after scrolling stops.
 */
export default function ScrollbarAutoHide() {
  useEffect(() => {
    const timers = new WeakMap<HTMLElement, number>();

    // Invalidate the scrollbar's cached paint so Blink re-renders it against the
    // current style (i.e. hides it once no longer hovered/scrolling). Toggling
    // overflow between auto and scroll both reserve the same gutter and keep
    // scroll position, so this doesn't shift layout.
    function repaint(el: HTMLElement) {
      const prev = el.style.overflowY;
      el.style.overflowY =
        getComputedStyle(el).overflowY === "scroll" ? "auto" : "scroll";
      void el.offsetHeight;
      el.style.overflowY = prev;
    }

    function onScroll(e: Event) {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      el.classList.add("is-scrolling");
      const prev = timers.get(el);
      if (prev) window.clearTimeout(prev);
      timers.set(
        el,
        window.setTimeout(() => {
          el.classList.remove("is-scrolling");
          if (el.classList.contains("hc-scroll-hoverbar")) repaint(el);
        }, 700)
      );
    }

    // Track which hover-reveal scroll area the pointer is over. Blink won't
    // repaint the bar on its own when :hover is gained or lost (unless the
    // pointer crosses the bar itself), so on every boundary crossing we repaint
    // the area just left (to hide it) and the area just entered (to reveal it).
    let hovered: HTMLElement | null = null;
    function onOver(e: MouseEvent) {
      const bar =
        e.target instanceof Element
          ? (e.target.closest<HTMLElement>(".hc-scroll-hoverbar"))
          : null;
      if (bar === hovered) return;
      if (hovered) repaint(hovered);
      if (bar) repaint(bar);
      hovered = bar;
    }

    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("mouseover", onOver, true);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("mouseover", onOver, true);
    };
  }, []);

  return null;
}
