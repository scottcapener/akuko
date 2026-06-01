"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Image from "next/image";
import { useAkukoDb } from "@/lib/useAkukoDb";
import LeftColumn from "@/components/LeftColumn";
import CenterColumn from "@/components/CenterColumn";
import RightColumn from "@/components/RightColumn";
import { Scene } from "@/lib/types";

type MobilePanel = "left" | "right" | null;

const LEFT_MIN = 160;
const LEFT_MAX = 360;
const RIGHT_MIN = 160;
const RIGHT_MAX = 400;
const LEFT_DEFAULT = 208;
const RIGHT_DEFAULT = 240;

function useColumnResize(defaultPx: number, min: number, max: number, direction: 1 | -1 = 1) {
  const [width, setWidth] = useState(defaultPx);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragging.current) return;
      const delta = (e.clientX - startX.current) * direction;
      setWidth(Math.min(max, Math.max(min, startW.current + delta)));
    }
    function onMouseUp() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [min, max, direction]);

  return { width, onMouseDown };
}

export default function WritePage() {
  const store = useAkukoDb();
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const left = useColumnResize(LEFT_DEFAULT, LEFT_MIN, LEFT_MAX, 1);
  const right = useColumnResize(RIGHT_DEFAULT, RIGHT_MIN, RIGHT_MAX, -1);

  useEffect(() => {
    const name = store.book?.title?.trim();
    document.title = name ? `Hakuko – ${name}` : "Hakuko";
  }, [store.book?.title]);

  if (!store.hydrated || !store.book || !store.activeChapter) {
    return <div className="h-full bg-[#18181a]" />;
  }

  function openPanel(p: MobilePanel) {
    setMobilePanel((prev) => (prev === p ? null : p));
  }

  // Merge live chapters array into book so LeftColumn grid renders correctly
  const bookWithChapters = { ...store.book, chapters: store.chapters };

  const leftProps = {
    book: bookWithChapters,
    activeChapter: store.activeChapter,
    onBookTitleChange: store.setBookTitle,
    onCoverImage: store.setCoverImage,
    onReorderChapters: store.reorderChapters,
  };

  const rightProps = {
    chapter: store.activeChapter,
    onAddImage: store.addLibraryImage,
    onRemoveImage: store.removeLibraryImage,
    onAddNote: store.addNote,
    onUpdateNote: store.updateNote,
    onRemoveNote: store.removeNote,
    onAddMusicLink: store.addMusicLink,
    onRemoveMusicLink: store.removeMusicLink,
  };

  return (
    <div className="h-full flex flex-col bg-[#18181a] overflow-hidden">
      {/* ── Mobile top bar ── */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-[#1f1f21] flex-shrink-0">
        <button
          onClick={() => openPanel("left")}
          className={`p-1.5 rounded transition-opacity ${mobilePanel === "left" ? "opacity-100" : "opacity-50 hover:opacity-80"}`}
        >
          <svg className="w-5 h-5 text-[#585563]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.966 8.966 0 00-6 2.292m0-14.25v14.25" />
          </svg>
        </button>
        <Image src="/hakuko-logo.svg" alt="Hakuko" width={52} height={12} className="opacity-50" />
        <button
          onClick={() => openPanel("right")}
          className={`p-1.5 rounded transition-opacity ${mobilePanel === "right" ? "opacity-100" : "opacity-50 hover:opacity-80"}`}
        >
          <Image src="/library.svg" alt="Library" width={20} height={20} />
        </button>
      </header>

      {/* ── Desktop layout ── */}
      <div className="flex-1 hidden md:flex overflow-hidden">
        <div className="flex-shrink-0 flex flex-col" style={{ width: left.width }}>
          <LeftColumn {...leftProps} onChapterClick={store.setActiveChapter} onAddChapter={store.addChapter} />
        </div>
        <div onMouseDown={left.onMouseDown} className="w-px flex-shrink-0 bg-[#1f1f21] hover:bg-[#c4a882]/40 cursor-col-resize transition-colors active:bg-[#c4a882]/60" />
        <div className="flex-1 overflow-hidden flex flex-col min-w-0">
          <CenterColumn
            chapter={store.activeChapter}
            saveStatus={store.saveStatus}
            onChapterTitleChange={store.updateChapterTitle}
            onSceneChange={(chapterId, sceneId, patch) => store.updateScene(chapterId, sceneId, patch as Partial<Scene>)}
            onAddScene={store.addScene}
            onAddImage={store.addLibraryImage}
          />
        </div>
        <div onMouseDown={right.onMouseDown} className="w-px flex-shrink-0 bg-[#1f1f21] hover:bg-[#c4a882]/40 cursor-col-resize transition-colors active:bg-[#c4a882]/60" />
        <div className="flex-shrink-0 flex flex-col" style={{ width: right.width }}>
          <RightColumn {...rightProps} />
        </div>
      </div>

      {/* ── Mobile single-column ── */}
      <div className="flex-1 md:hidden overflow-hidden flex flex-col">
        <CenterColumn
          chapter={store.activeChapter}
          saveStatus={store.saveStatus}
          onChapterTitleChange={store.updateChapterTitle}
          onSceneChange={(chapterId, sceneId, patch) => store.updateScene(chapterId, sceneId, patch as Partial<Scene>)}
          onAddScene={store.addScene}
          onAddImage={store.addLibraryImage}
        />
      </div>

      {/* ── Mobile slide-in panels ── */}
      {mobilePanel && (
        <div className="md:hidden fixed inset-0 bg-black/50 z-30" onClick={() => setMobilePanel(null)}>
          {/* X button visible in the backdrop strip beside the left panel */}
          {mobilePanel === "left" && (
            <button
              onClick={() => setMobilePanel(null)}
              className="absolute top-4 right-3 w-8 h-8 flex items-center justify-center text-white/60 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}
      <div className={`md:hidden fixed top-0 bottom-0 left-0 z-40 w-[calc(100%-44px)] transition-transform duration-200 ${mobilePanel === "left" ? "translate-x-0" : "-translate-x-full"}`}>
        <LeftColumn {...leftProps} onChapterClick={(id) => { store.setActiveChapter(id); setMobilePanel(null); }} onAddChapter={() => { store.addChapter(); setMobilePanel(null); }} />
      </div>
      <div className={`md:hidden fixed top-0 bottom-0 right-0 z-40 w-[85vw] transition-transform duration-200 ${mobilePanel === "right" ? "translate-x-0" : "translate-x-full"}`}>
        <RightColumn {...rightProps} onClose={() => setMobilePanel(null)} />
      </div>
    </div>
  );
}
