import { RefObject, useEffect, useRef } from "react";

// Edge auto-scroll for native HTML5 drag-and-drop.
//
// Attach to a scroll container: while a drag is in progress and the pointer
// sits within `EDGE` px of the top or bottom, the container scrolls toward that
// edge so you can reach drop targets that are off-screen. Speed ramps with how
// deep into the hot zone the pointer is. A requestAnimationFrame loop keeps
// scrolling even when the pointer is held still (native `dragover` only fires on
// movement, so reading scroll from the event alone would stall).
//
// The `dragover` listener is registered in the capture phase so a child that
// calls stopPropagation on its own drag handlers can't disable auto-scroll.

const EDGE = 64; // px hot zone at each edge
const MAX_SPEED = 16; // px per frame at the very edge

export function useAutoScrollOnDrag(ref: RefObject<HTMLElement | null>) {
  const velocity = useRef(0);
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const step = () => {
      if (velocity.current !== 0) {
        el.scrollTop += velocity.current;
      }
      rafId.current = requestAnimationFrame(step);
    };

    const start = () => {
      if (rafId.current === null) rafId.current = requestAnimationFrame(step);
    };

    const stop = () => {
      velocity.current = 0;
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
    };

    const onDragOver = (e: DragEvent) => {
      const rect = el.getBoundingClientRect();
      const y = e.clientY;
      let v = 0;
      if (y < rect.top + EDGE) {
        const depth = Math.min(1, (rect.top + EDGE - y) / EDGE);
        v = -Math.ceil(depth * MAX_SPEED);
      } else if (y > rect.bottom - EDGE) {
        const depth = Math.min(1, (y - (rect.bottom - EDGE)) / EDGE);
        v = Math.ceil(depth * MAX_SPEED);
      }
      velocity.current = v;
      if (v !== 0) start();
      else stop();
    };

    el.addEventListener("dragover", onDragOver, true);
    document.addEventListener("dragend", stop);
    document.addEventListener("drop", stop);

    return () => {
      el.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("dragend", stop);
      document.removeEventListener("drop", stop);
      stop();
    };
  }, [ref]);
}
