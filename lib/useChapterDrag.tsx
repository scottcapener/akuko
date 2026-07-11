"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

// Identifies the chapter currently being dragged. `fromIndex` is its index within
// its source section — used for same-section reorders (a cross-section move
// recomputes the target index from the drop position). Mirrors useSceneDrag.
export interface ChapterDragPayload {
  chapterId: string;
  fromSectionId: string;
  fromIndex: number;
}

interface ChapterDragValue {
  payload: ChapterDragPayload | null;
  begin: (payload: ChapterDragPayload) => void;
  end: () => void;
  // Synchronous read for `onDrop` handlers that shouldn't wait on a re-render.
  peek: () => ChapterDragPayload | null;
}

const ChapterDragContext = createContext<ChapterDragValue | null>(null);

export function ChapterDragProvider({ children }: { children: React.ReactNode }) {
  const [payload, setPayload] = useState<ChapterDragPayload | null>(null);
  const payloadRef = useRef<ChapterDragPayload | null>(null);

  const begin = useCallback((next: ChapterDragPayload) => {
    payloadRef.current = next;
    setPayload(next);
  }, []);
  const end = useCallback(() => {
    payloadRef.current = null;
    setPayload(null);
  }, []);
  const peek = useCallback(() => payloadRef.current, []);

  const value = useMemo(() => ({ payload, begin, end, peek }), [payload, begin, end, peek]);
  return <ChapterDragContext.Provider value={value}>{children}</ChapterDragContext.Provider>;
}

export function useChapterDrag(): ChapterDragValue {
  const ctx = useContext(ChapterDragContext);
  if (!ctx) throw new Error("useChapterDrag must be used within a ChapterDragProvider");
  return ctx;
}
