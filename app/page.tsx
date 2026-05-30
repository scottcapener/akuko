"use client";

import { useState } from "react";
import Image from "next/image";
import { useAkuko } from "@/lib/useAkuko";
import LeftColumn from "@/components/LeftColumn";
import CenterColumn from "@/components/CenterColumn";
import RightColumn from "@/components/RightColumn";
import { Scene } from "@/lib/types";

type MobilePanel = "left" | "right" | null;

export default function Home() {
  const store = useAkuko();
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);

  if (!store.hydrated) {
    return <div className="h-full bg-[#18181a]" />;
  }

  function openPanel(p: MobilePanel) {
    setMobilePanel((prev) => (prev === p ? null : p));
  }

  const leftProps = {
    book: store.book,
    activeChapter: store.activeChapter,
    onBookTitleChange: store.setBookTitle,
    onCoverImage: store.setCoverImage,
    onReorderChapters: store.reorderChapters,
  };

  const rightProps = {
    chapter: store.activeChapter,
    onAddImage: store.addLibraryImage,
    onRemoveImage: store.removeLibraryImage,
    onAddFile: store.addLibraryFile,
    onRemoveFile: store.removeLibraryFile,
    onAddMusicLink: store.addMusicLink,
    onRemoveMusicLink: store.removeMusicLink,
  };

  return (
    <div className="h-full flex flex-col bg-[#18181a] overflow-hidden">
      {/* ── Mobile top bar ── */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-[#2a2a2c] flex-shrink-0">
        {/* Book icon */}
        <button
          onClick={() => openPanel("left")}
          className={`p-1.5 rounded transition-opacity ${
            mobilePanel === "left" ? "opacity-100" : "opacity-50 hover:opacity-80"
          }`}
        >
          <svg
            className="w-5 h-5 text-[#9b9890]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.966 8.966 0 00-6 2.292m0-14.25v14.25"
            />
          </svg>
        </button>

        {/* Wordmark — logo.svg cropped to "ak" visually via the full logo */}
        <Image src="/logo.svg" alt="Akuko" width={52} height={15} className="opacity-50" />

        {/* Library icon */}
        <button
          onClick={() => openPanel("right")}
          className={`p-1.5 rounded transition-opacity ${
            mobilePanel === "right" ? "opacity-100" : "opacity-50 hover:opacity-80"
          }`}
        >
          <Image src="/library.svg" alt="Library" width={20} height={20} />
        </button>
      </header>

      {/* ── Desktop three-column layout ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left column — desktop */}
        <div className="hidden md:flex w-52 flex-shrink-0 flex-col">
          <LeftColumn
            {...leftProps}
            onChapterClick={store.setActiveChapter}
            onAddChapter={store.addChapter}
          />
        </div>

        {/* Center column */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <CenterColumn
            chapter={store.activeChapter}
            saveStatus={store.saveStatus}
            onChapterTitleChange={store.updateChapterTitle}
            onSceneChange={(chapterId, sceneId, patch) =>
              store.updateScene(chapterId, sceneId, patch as Partial<Scene>)
            }
            onAddScene={store.addScene}
            onAddImage={store.addLibraryImage}
          />
        </div>

        {/* Right column — desktop */}
        <div className="hidden md:flex w-60 flex-shrink-0 flex-col">
          <RightColumn {...rightProps} />
        </div>
      </div>

      {/* ── Mobile slide-in panels ── */}
      {mobilePanel && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setMobilePanel(null)}
        />
      )}

      {/* Left slide-in */}
      <div
        className={`md:hidden fixed top-0 bottom-0 left-0 z-40 w-[75vw] transition-transform duration-200 ${
          mobilePanel === "left" ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <LeftColumn
          {...leftProps}
          onChapterClick={(id) => {
            store.setActiveChapter(id);
            setMobilePanel(null);
          }}
          onAddChapter={() => {
            store.addChapter();
            setMobilePanel(null);
          }}
        />
      </div>

      {/* Right slide-in */}
      <div
        className={`md:hidden fixed top-0 bottom-0 right-0 z-40 w-[75vw] transition-transform duration-200 ${
          mobilePanel === "right" ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <RightColumn {...rightProps} />
      </div>
    </div>
  );
}
