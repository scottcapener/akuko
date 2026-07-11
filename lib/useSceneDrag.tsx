"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

// Identifies the scene currently being dragged. `fromIndex` is the scene's index
// within its source chapter — used only for same-chapter reorders (a cross-chapter
// move recomputes the target index from the drop position).
export interface SceneDragPayload {
  sceneId: string;
  fromChapterId: string;
  fromIndex: number;
}

interface SceneDragValue {
  // The in-flight scene drag, or null when no scene is being dragged. Consumers
  // read this to know a scene drag is active (vs. a chapter/section drag) and to
  // know which scene it is. Native `dataTransfer` can't be read during `dragover`,
  // so this shared payload is how drop targets learn the source across components.
  payload: SceneDragPayload | null;
  begin: (payload: SceneDragPayload) => void;
  end: () => void;
  // Synchronous read of the current payload, for `onDrop` handlers that shouldn't
  // depend on a re-render having landed. Mirrors `payload`.
  peek: () => SceneDragPayload | null;
}

const SceneDragContext = createContext<SceneDragValue | null>(null);

export function SceneDragProvider({ children }: { children: React.ReactNode }) {
  const [payload, setPayload] = useState<SceneDragPayload | null>(null);
  const payloadRef = useRef<SceneDragPayload | null>(null);

  const begin = useCallback((next: SceneDragPayload) => {
    payloadRef.current = next;
    setPayload(next);
  }, []);
  const end = useCallback(() => {
    payloadRef.current = null;
    setPayload(null);
  }, []);
  const peek = useCallback(() => payloadRef.current, []);

  const value = useMemo(() => ({ payload, begin, end, peek }), [payload, begin, end, peek]);
  return <SceneDragContext.Provider value={value}>{children}</SceneDragContext.Provider>;
}

export function useSceneDrag(): SceneDragValue {
  const ctx = useContext(SceneDragContext);
  if (!ctx) throw new Error("useSceneDrag must be used within a SceneDragProvider");
  return ctx;
}
