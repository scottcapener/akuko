"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

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

  // Safety net: always clear the payload when a native drag ends. The drag source
  // can unmount mid-drag (e.g. the source chapter's scene list closes when another
  // chapter is hovered), which suppresses its own dragend — without this the drop
  // target would stay stuck in its highlighted "targeted" state. These document
  // listeners run after React's own drop handlers (which read `peek` first).
  useEffect(() => {
    document.addEventListener("drop", end);
    document.addEventListener("dragend", end);
    return () => {
      document.removeEventListener("drop", end);
      document.removeEventListener("dragend", end);
    };
  }, [end]);

  const value = useMemo(() => ({ payload, begin, end, peek }), [payload, begin, end, peek]);
  return <SceneDragContext.Provider value={value}>{children}</SceneDragContext.Provider>;
}

export function useSceneDrag(): SceneDragValue {
  const ctx = useContext(SceneDragContext);
  if (!ctx) throw new Error("useSceneDrag must be used within a SceneDragProvider");
  return ctx;
}
