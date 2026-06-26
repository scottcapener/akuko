"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import { Chapter, Scene, LibraryImage } from "@/lib/types";
import { SaveStatus } from "@/lib/useHotCocoaDb";

interface Props {
  chapter: Chapter;
  saveStatus: SaveStatus;
  onChapterTitleChange: (id: string, title: string) => void;
  onSceneChange: (chapterId: string, sceneId: string, patch: Partial<Scene>) => void;
  onAddScene: (chapterId: string) => void;
  onReorderScenes: (chapterId: string, from: number, to: number) => void;
  onDeleteScene: (chapterId: string, sceneId: string) => void;
  onAddImage: (chapterId: string, img: LibraryImage) => void;
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function SceneBlock({
  scene,
  chapterId,
  index,
  onSceneChange,
  onDragStart,
  onDragOver,
  onDrop,
  onDeleteScene,
}: {
  scene: Scene;
  chapterId: string;
  index: number;
  onSceneChange: (chapterId: string, sceneId: string, patch: Partial<Scene>) => void;
  onDragStart: (index: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (toIndex: number) => void;
  onDeleteScene: (chapterId: string, sceneId: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);

  // Set innerHTML on mount and when navigating to a different scene.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.innerHTML = scene.body;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.id]);

  function handleWrapperClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === labelRef.current) return;
    bodyRef.current?.focus();
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const items = Array.from(e.clipboardData.items);
    if (items.some((it) => it.type.startsWith("image/"))) {
      // Prevent browser from inserting an <img> into the contentEditable;
      // CenterColumn's onPaste handler (which receives the bubbled event) adds it to the library.
      e.preventDefault();
      return;
    }
    // Strip HTML — insert plain text only.
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (
      (e.metaKey || e.ctrlKey) &&
      !["i", "z", "y", "a", "c", "x", "v"].includes(e.key.toLowerCase())
    ) {
      e.preventDefault();
    }
  }

  return (
    <div
      className={`rounded-lg mb-2 transition-colors relative group/scene ${
        isDragOver ? "ring-1 ring-accent/40" : ""
      } ${focused ? "bg-elevated" : "bg-transparent hover:bg-panel"}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); onDragOver(e); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragOver(false); onDrop(index); }}
    >
      {/* Drag handle — left edge, visible on hover */}
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          onDragStart(index);
        }}
        className="absolute left-0 top-0 bottom-0 w-5 flex items-start pt-3 justify-center opacity-0 group-hover/scene:opacity-100 transition-opacity cursor-grab active:cursor-grabbing z-10"
      >
        <svg className="w-3 h-3 text-subtle" fill="currentColor" viewBox="0 0 16 16">
          <circle cx="5" cy="4" r="1.2" />
          <circle cx="5" cy="8" r="1.2" />
          <circle cx="5" cy="12" r="1.2" />
          <circle cx="10" cy="4" r="1.2" />
          <circle cx="10" cy="8" r="1.2" />
          <circle cx="10" cy="12" r="1.2" />
        </svg>
      </div>

      <div className="px-4 py-3 pl-5" onClick={handleWrapperClick}>
        {/* Label row: input + delete button/confirmation */}
        <div className="flex items-center gap-1 mb-2 min-h-[1.5rem]">
          {confirmDelete ? (
            // Inline delete confirmation — replaces the label input
            <div className="flex items-center gap-2 flex-1">
              <span className="text-[11px] font-medium tracking-wide uppercase text-muted">
                Delete scene?
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
                className="text-[11px] font-medium tracking-wide uppercase text-subtle hover:text-muted transition-colors"
              >
                No
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDeleteScene(chapterId, scene.id); }}
                className="text-[11px] font-medium tracking-wide uppercase text-accent hover:text-text transition-colors"
              >
                Yes
              </button>
            </div>
          ) : (
            <>
              <input
                ref={labelRef}
                maxLength={260}
                value={scene.label}
                placeholder="Scene label…"
                onChange={(e) => onSceneChange(chapterId, scene.id, { label: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                className="flex-1 min-w-0 bg-transparent text-label-m uppercase text-subtle placeholder:text-subtle/40 focus:outline-none cursor-text"
                style={{ fontFamily: "inherit" }}
              />
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
                className="opacity-0 group-hover/scene:opacity-100 text-subtle hover:text-error transition-all flex-shrink-0"
                title="Delete scene"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </>
          )}
        </div>

        {/* Scene body */}
        <div
          ref={bodyRef}
          contentEditable
          suppressContentEditableWarning
          onFocus={() => { setFocused(true); setConfirmDelete(false); }}
          onBlur={() => setFocused(false)}
          onInput={() => onSceneChange(chapterId, scene.id, { body: bodyRef.current?.innerHTML ?? "" })}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          className="w-full bg-transparent text-text text-body-l focus:outline-none empty:before:content-['Write_here…'] empty:before:text-subtle/30 empty:before:pointer-events-none [&_em]:italic"
          style={{ fontFamily: "inherit", minHeight: "3em" }}
        />
      </div>
    </div>
  );
}

export default function CenterColumn({
  chapter,
  saveStatus,
  onChapterTitleChange,
  onSceneChange,
  onAddScene,
  onReorderScenes,
  onDeleteScene,
  onAddImage,
}: Props) {
  const dragSceneIndex = useRef<number | null>(null);

  // Clipboard paste → library image (when focus is in a scene body)
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      const items = Array.from(e.clipboardData.items);
      const imageItem = items.find((it) => it.type.startsWith("image/"));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      e.preventDefault();
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        onAddImage(chapter.id, {
          id: makeId(),
          name: `pasted-${Date.now()}.png`,
          dataUrl,
        });
      };
      reader.readAsDataURL(file);
    },
    [chapter.id, onAddImage]
  );

  return (
    <div
      className="flex flex-col h-full bg-bg w-full relative"
      onPaste={handlePaste}
    >
      {/* Save indicator */}
      {saveStatus !== "idle" && (
        <div
          className={`absolute top-4 right-4 text-[10px] uppercase tracking-widest transition-opacity z-10 ${
            saveStatus === "saving" ? "text-subtle" : "text-accent"
          }`}
        >
          {saveStatus === "saving" ? "Saving…" : "Saved"}
        </div>
      )}

      {/* Chapter title */}
      <div className="w-full flex justify-center border-b border-border-subtle flex-shrink-0">
        <div className="w-full max-w-[700px] px-6 pt-6 pb-4">
          <input
            value={chapter.title}
            placeholder="Chapter title…"
            onChange={(e) => onChapterTitleChange(chapter.id, e.target.value)}
            className="w-full bg-transparent text-heading-l text-text placeholder:text-subtle/40 focus:outline-none"
          />
        </div>
      </div>

      {/* Scene feed */}
      <div className="flex-1 overflow-y-auto flex justify-center">
        <div className="w-full max-w-[700px] px-4 py-4">
          {chapter.scenes.map((scene, i) => (
            <SceneBlock
              key={scene.id}
              scene={scene}
              chapterId={chapter.id}
              index={i}
              onSceneChange={onSceneChange}
              onDragStart={(idx) => { dragSceneIndex.current = idx; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(toIdx) => {
                if (dragSceneIndex.current !== null && dragSceneIndex.current !== toIdx) {
                  onReorderScenes(chapter.id, dragSceneIndex.current, toIdx);
                }
                dragSceneIndex.current = null;
              }}
              onDeleteScene={onDeleteScene}
            />
          ))}

          {/* Add scene button */}
          <button
            onClick={() => onAddScene(chapter.id)}
            className="mt-2 ml-4 mb-16 flex items-center gap-2 transition-colors group"
          >
            <Image
              src="/plus.svg"
              alt="Add scene"
              width={16}
              height={16}
              className="opacity-40 group-hover:opacity-100 transition-opacity"
            />
            <span className="text-body-m text-subtle group-hover:text-accent transition-colors">Add scene</span>
          </button>
        </div>
      </div>
    </div>
  );
}
