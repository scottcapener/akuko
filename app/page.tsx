"use client";

import { useState } from "react";
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

  return (
    <div className="h-full flex flex-col bg-[#18181a] overflow-hidden">
      {/* ── Mobile top bar ── */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-[#2a2a2c] flex-shrink-0">
        {/* Book icon */}
        <button
          onClick={() => openPanel("left")}
          className={`p-1.5 rounded transition-colors ${
            mobilePanel === "left"
              ? "text-[#c4a882]"
              : "text-[#9b9890] hover:text-[#e8e6e3]"
          }`}
        >
          <svg
            className="w-5 h-5"
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

        {/* Wordmark */}
        <span
          className="font-mono text-base tracking-tight text-[#c4a882] select-none"
          style={{ fontFamily: "var(--font-mono, monospace)" }}
        >
          ak
        </span>

        {/* Library icon */}
        <button
          onClick={() => openPanel("right")}
          className={`p-1.5 rounded transition-colors ${
            mobilePanel === "right"
              ? "text-[#c4a882]"
              : "text-[#9b9890] hover:text-[#e8e6e3]"
          }`}
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
            />
          </svg>
        </button>
      </header>

      {/* ── Desktop three-column layout ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left column — desktop */}
        <div className="hidden md:flex w-52 flex-shrink-0 flex-col">
          <LeftColumn
            book={store.book}
            activeChapter={store.activeChapter}
            onBookTitleChange={store.setBookTitle}
            onChapterClick={store.setActiveChapter}
            onAddChapter={store.addChapter}
            onReorderChapters={store.reorderChapters}
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
          />
        </div>

        {/* Right column — desktop */}
        <div className="hidden md:flex w-60 flex-shrink-0 flex-col">
          <RightColumn
            chapter={store.activeChapter}
            onAddImage={store.addLibraryImage}
            onRemoveImage={store.removeLibraryImage}
            onAddFile={store.addLibraryFile}
            onRemoveFile={store.removeLibraryFile}
            onAddMusicLink={store.addMusicLink}
            onRemoveMusicLink={store.removeMusicLink}
          />
        </div>
      </div>

      {/* ── Mobile slide-in panels ── */}
      {/* Backdrop */}
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
          book={store.book}
          activeChapter={store.activeChapter}
          onBookTitleChange={store.setBookTitle}
          onChapterClick={(id) => {
            store.setActiveChapter(id);
            setMobilePanel(null);
          }}
          onAddChapter={() => {
            store.addChapter();
            setMobilePanel(null);
          }}
          onReorderChapters={store.reorderChapters}
        />
      </div>

      {/* Right slide-in */}
      <div
        className={`md:hidden fixed top-0 bottom-0 right-0 z-40 w-[75vw] transition-transform duration-200 ${
          mobilePanel === "right" ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <RightColumn
          chapter={store.activeChapter}
          onAddImage={store.addLibraryImage}
          onRemoveImage={store.removeLibraryImage}
          onAddFile={store.addLibraryFile}
          onRemoveFile={store.removeLibraryFile}
          onAddMusicLink={store.addMusicLink}
          onRemoveMusicLink={store.removeMusicLink}
        />
      </div>
    </div>
  );
}
