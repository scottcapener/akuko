"use client";

import type React from "react";
import { useState, useRef, useCallback, useEffect } from "react";

// Drag-to-resize for a fixed-position column (the writer's Book/Library panels
// and the Workspace Nav Panel). `direction` is 1 for a divider on the column's
// right edge (drag right = wider) and -1 for one on the left edge. The width is
// restored from localStorage and persisted only on drag-end.
//
// Note: the width is read lazily (synchronously) on the client, so a consumer
// that renders during SSR/hydration should gate applying the non-default width
// until after mount to avoid a hydration mismatch (see the writer's blank
// placeholder, and the Workspace layout's `mounted` flag).
export function useColumnResize(
  storageKey: string,
  defaultPx: number,
  min: number,
  max: number,
  direction: 1 | -1 = 1
) {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return defaultPx;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw != null) {
        const n = parseInt(raw, 10);
        if (!Number.isNaN(n)) return Math.min(max, Math.max(min, n));
      }
    } catch {}
    return defaultPx;
  });
  // `resizing` is state (not just the `dragging` ref) so the column wrapper can
  // drop its width transition mid-drag — otherwise the collapse/expand easing
  // would also apply to resize, making the edge lag behind the cursor.
  const [resizing, setResizing] = useState(false);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);
  // Mirrors `width` so the drag-end handler can persist the final value without
  // re-registering the window listeners on every mousemove.
  const widthRef = useRef(width);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    setResizing(true);
    startX.current = e.clientX;
    startW.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragging.current) return;
      const delta = (e.clientX - startX.current) * direction;
      const next = Math.min(max, Math.max(min, startW.current + delta));
      widthRef.current = next;
      setWidth(next);
    }
    function onMouseUp() {
      if (!dragging.current) return;
      dragging.current = false;
      setResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Persist only on drag-end, not on every frame.
      try { localStorage.setItem(storageKey, String(widthRef.current)); } catch {}
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [min, max, direction, storageKey]);

  return { width, onMouseDown, resizing };
}
