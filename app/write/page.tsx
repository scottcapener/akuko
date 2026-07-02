"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useHotCocoaDb } from "@/lib/useHotCocoaDb";
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
  const router = useRouter();
  const store = useHotCocoaDb();
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const left = useColumnResize(LEFT_DEFAULT, LEFT_MIN, LEFT_MAX, 1);
  const right = useColumnResize(RIGHT_DEFAULT, RIGHT_MIN, RIGHT_MAX, -1);

  // Stable refs so the paste listener never goes stale
  const activeChapterRef = useRef(store.activeChapter);
  activeChapterRef.current = store.activeChapter;
  const addLibraryImageRef = useRef(store.addLibraryImage);
  addLibraryImageRef.current = store.addLibraryImage;

  // Route guard: unauthenticated users go to /login.
  // Skipped in development when NEXT_PUBLIC_DEV_USER_ID is set.
  useEffect(() => {
    if (process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DEV_USER_ID) return;
    createClient().auth.getUser().then(({ data: { user } }) => {
      if (!user) router.replace("/login");
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global image paste — fires when focus is outside a text/contenteditable field
  // (when focus IS in a scene body, CenterColumn's own onPaste handler adds the image)
  useEffect(() => {
    function handleGlobalPaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement;
      // CenterColumn has its own onPaste that adds the image for any paste within it.
      // Skip here so the image isn't added twice — the tag checks below miss focusable
      // non-editable targets inside CenterColumn (e.g. a focused button), which slipped
      // through and caused a double-add.
      if (target.closest?.('[data-paste-scope="center"]')) return;
      if (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((it) => it.type.startsWith("image/"));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file || !activeChapterRef.current) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        addLibraryImageRef.current(activeChapterRef.current!.id, {
          id: Math.random().toString(36).slice(2, 10),
          name: `pasted-${Date.now()}.png`,
          dataUrl: ev.target?.result as string,
        });
      };
      reader.readAsDataURL(file);
    }
    document.addEventListener("paste", handleGlobalPaste);
    return () => document.removeEventListener("paste", handleGlobalPaste);
  }, []);

  useEffect(() => {
    const name = store.book?.title?.trim();
    document.title = name ? `Hot Cocoa – ${name}` : "Hot Cocoa";
  }, [store.book?.title]);

  if (!store.hydrated || !store.book || !store.activeChapter) {
    return <div className="h-full bg-bg" />;
  }

  function openPanel(p: MobilePanel) {
    setMobilePanel((prev) => (prev === p ? null : p));
  }

  const leftProps = {
    book: store.book,
    sections: store.sections,
    activeChapter: store.activeChapter,
    onBookTitleChange: store.setBookTitle,
    onCoverImage: store.setCoverImage,
    onReorderChapters: store.reorderChapters,
    onDeleteChapter: store.deleteChapter,
    onAddSection: store.addSection,
    onUpdateSectionLabel: store.updateSectionLabel,
    onReorderSections: store.reorderSections,
    onDeleteSection: store.deleteSection,
  };

  const rightProps = {
    chapter: store.activeChapter,
    loading: !store.activeChapterLoaded,
    onAddImage: store.addLibraryImage,
    onRemoveImage: store.removeLibraryImage,
    onRefreshImage: store.refreshLibraryImageUrl,
    onAddNote: store.addNote,
    onUpdateNote: store.updateNote,
    onRemoveNote: store.removeNote,
    onAddMusicLink: store.addMusicLink,
    onRemoveMusicLink: store.removeMusicLink,
  };

  return (
    <div className="h-full flex flex-col bg-bg overflow-hidden">
      {/* ── Mobile top bar ── */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border-subtle flex-shrink-0">
        <button
          onClick={() => openPanel("left")}
          className={`p-1.5 rounded transition-opacity ${mobilePanel === "left" ? "opacity-100" : "opacity-50 hover:opacity-80"}`}
        >
          <svg className="w-7 h-7 text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.966 8.966 0 00-6 2.292m0-14.25v14.25" />
          </svg>
        </button>
        <Image src="/logo-S.svg" alt="Hot Cocoa" width={105} height={20} style={{ filter: 'brightness(0) invert(1)' }} />
        <button
          onClick={() => openPanel("right")}
          className={`p-1.5 rounded transition-opacity ${mobilePanel === "right" ? "opacity-100" : "opacity-50 hover:opacity-80"}`}
        >
          <Image src="/library.svg" alt="Library" width={28} height={28} />
        </button>
      </header>

      {/* ── Desktop layout ── */}
      <div className="flex-1 hidden md:flex overflow-hidden">
        <div className="flex-shrink-0 flex flex-col" style={{ width: left.width }}>
          <LeftColumn {...leftProps} onChapterClick={store.setActiveChapter} onAddChapter={store.addChapter} />
        </div>
        <div onMouseDown={left.onMouseDown} className="w-px flex-shrink-0 bg-border-subtle hover:bg-accent/40 cursor-col-resize transition-colors active:bg-accent/60" />
        <div className="flex-1 overflow-hidden flex flex-col min-w-0">
          <CenterColumn
            chapter={store.activeChapter}
            saveStatus={store.saveStatus}
            onChapterTitleChange={store.updateChapterTitle}
            onSceneChange={(chapterId, sceneId, patch) => store.updateScene(chapterId, sceneId, patch as Partial<Scene>)}
            onAddScene={store.addScene}
            onReorderScenes={store.reorderScenes}
            onDeleteScene={store.deleteScene}
            onAddImage={store.addLibraryImage}
            loading={!store.activeChapterLoaded}
          />
        </div>
        <div onMouseDown={right.onMouseDown} className="w-px flex-shrink-0 bg-border-subtle hover:bg-accent/40 cursor-col-resize transition-colors active:bg-accent/60" />
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
          onReorderScenes={store.reorderScenes}
          onDeleteScene={store.deleteScene}
          onAddImage={store.addLibraryImage}
          loading={!store.activeChapterLoaded}
        />
      </div>

      {/* ── Mobile slide-in panels (full-width, per CocoaBar) ── */}
      {mobilePanel && (
        <div className="md:hidden fixed inset-0 bg-scrim z-30" onClick={() => setMobilePanel(null)} />
      )}
      <div className={`md:hidden fixed inset-y-0 left-0 z-40 w-full transition-transform duration-200 ${mobilePanel === "left" ? "translate-x-0" : "-translate-x-full"}`}>
        <LeftColumn
          {...leftProps}
          onChapterClick={(id) => { store.setActiveChapter(id); setMobilePanel(null); }}
          onAddChapter={(sectionId) => { store.addChapter(sectionId); setMobilePanel(null); }}
          onDeleteChapter={store.deleteChapter}
          onClose={() => setMobilePanel(null)}
        />
      </div>
      <div className={`md:hidden fixed inset-y-0 right-0 z-40 w-full transition-transform duration-200 ${mobilePanel === "right" ? "translate-x-0" : "translate-x-full"}`}>
        <RightColumn {...rightProps} onClose={() => setMobilePanel(null)} />
      </div>
    </div>
  );
}
