import { useRef, useState } from "react";
import type React from "react";

// Drag-reorder for a vertical list with an insertion-line indicator.
//
// Semantics are gap-based: as you drag, `activeGap` tracks the slot the item
// would drop into (0..count, where g means "before item g"). On drop we convert
// that gap to a final array index and call `onReorder(from, to)`.
//
// Drag start/end and drop-zone handlers are exposed separately so a caller can
// put the drag handle on a sub-element (e.g. a header row) while the whole item
// remains a drop zone. Each list should own its own hook instance — the
// per-instance drag ref is what scopes a drag to a single list, so nested lists
// don't interfere with one another.
export function useReorderList(onReorder: (from: number, to: number) => void) {
  const dragIndex = useRef<number | null>(null);
  const [activeGap, setActiveGap] = useState<number | null>(null);

  function reset() {
    dragIndex.current = null;
    setActiveGap(null);
  }

  function dragHandleProps(index: number) {
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        dragIndex.current = index;
        e.dataTransfer.effectAllowed = "move";
        // Stop the event bubbling to an enclosing reorder list (e.g. a chapter
        // row inside a draggable section) so only this list registers the drag.
        e.stopPropagation();
      },
      onDragEnd: reset,
    };
  }

  function dropZoneProps(index: number) {
    return {
      onDragOver: (e: React.DragEvent) => {
        if (dragIndex.current === null) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height / 2;
        setActiveGap(after ? index + 1 : index);
      },
      onDrop: (e: React.DragEvent) => {
        if (dragIndex.current === null) return;
        e.preventDefault();
        e.stopPropagation();
        const from = dragIndex.current;
        const gap = activeGap;
        if (gap !== null) {
          const to = gap > from ? gap - 1 : gap;
          if (to !== from) onReorder(from, to);
        }
        reset();
      },
    };
  }

  return { activeGap, dragHandleProps, dropZoneProps };
}
