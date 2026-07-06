import { useRef, useState } from "react";
import type React from "react";

// Drag-reorder for a grid of cells (e.g. chapter thumbnails, library images).
//
// A horizontal insertion line reads poorly across grid rows, so grids use a
// drop-onto-cell model instead: the cell under the pointer is highlighted
// (`overIndex`) and dropping moves the dragged item to that cell's index.
// Own one hook instance per grid; the per-instance drag ref scopes the drag so
// a grid nested inside another reorderable region can't trigger it.
export function useReorderGrid(onReorder: (from: number, to: number) => void) {
  const dragIndex = useRef<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  function reset() {
    dragIndex.current = null;
    setOverIndex(null);
  }

  function cellProps(index: number) {
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        dragIndex.current = index;
        e.dataTransfer.effectAllowed = "move";
        e.stopPropagation();
      },
      onDragOver: (e: React.DragEvent) => {
        if (dragIndex.current === null) return;
        e.preventDefault();
        setOverIndex(index);
      },
      onDragLeave: () => {
        setOverIndex((cur) => (cur === index ? null : cur));
      },
      onDrop: (e: React.DragEvent) => {
        if (dragIndex.current === null) return;
        e.preventDefault();
        e.stopPropagation();
        const from = dragIndex.current;
        if (from !== index) onReorder(from, index);
        reset();
      },
      onDragEnd: reset,
    };
  }

  return { overIndex, cellProps };
}
