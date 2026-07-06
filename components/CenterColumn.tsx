"use client";

import { Fragment, useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import { Chapter, Scene, LibraryImage } from "@/lib/types";
import { SaveStatus } from "@/lib/useHotCocoaDb";
import { DropLine } from "@/components/ui/DropLine";
import { useReorderList } from "@/lib/useReorderList";
import { useAutoScrollOnDrag } from "@/lib/useAutoScrollOnDrag";

interface Props {
  chapter: Chapter;
  saveStatus: SaveStatus;
  onChapterTitleChange: (id: string, title: string) => void;
  onSceneChange: (chapterId: string, sceneId: string, patch: Partial<Scene>) => void;
  onAddScene: (chapterId: string) => void;
  onReorderScenes: (chapterId: string, from: number, to: number) => void;
  onDeleteScene: (chapterId: string, sceneId: string) => void;
  onAddImage: (chapterId: string, img: LibraryImage) => void;
  loading?: boolean;
  scenesVisible?: boolean;
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function SceneBlock({
  scene,
  chapterId,
  index,
  onSceneChange,
  dragHandleProps,
  dropZoneProps,
  onDeleteScene,
  scenesVisible = true,
}: {
  scene: Scene;
  chapterId: string;
  index: number;
  onSceneChange: (chapterId: string, sceneId: string, patch: Partial<Scene>) => void;
  dragHandleProps: (index: number) => React.HTMLAttributes<HTMLElement> & { draggable?: boolean };
  dropZoneProps: (index: number) => React.HTMLAttributes<HTMLElement>;
  onDeleteScene: (chapterId: string, sceneId: string) => void;
  scenesVisible?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
      {...dropZoneProps(index)}
      className={`rounded-lg mb-2 transition-colors relative group/scene ${
        focused ? "bg-elevated" : "bg-transparent hover:bg-panel"
      }`}
    >
      <div className="px-4 py-3" onClick={handleWrapperClick}>
        {/* Scene Header: description label + delete (×/confirmation) on the right.
            The row itself is the drag handle for reordering — disabled while the
            scene is focused so the description text stays selectable. Hidden in the
            "sceneless" view (structure is untouched — just not shown). */}
        {scenesVisible && (
        <div
          {...dragHandleProps(index)}
          draggable={!focused}
          className="flex items-center gap-2 mb-2 min-h-[1.5rem] cursor-grab active:cursor-grabbing"
        >
          <input
            ref={labelRef}
            maxLength={260}
            value={scene.label}
            placeholder="Scene description…"
            onChange={(e) => onSceneChange(chapterId, scene.id, { label: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            className={`flex-1 min-w-0 bg-transparent text-label-m uppercase text-subtle placeholder:text-subtle/40 focus:outline-none ${focused ? "cursor-text" : "cursor-grab"}`}
            style={{ fontFamily: "inherit" }}
          />
          {confirmDelete ? (
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-label-m uppercase text-accent whitespace-nowrap">
                Delete scene?
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
                className="bg-panel rounded px-2 py-1 text-[11px] tracking-[0.33px] uppercase text-text hover:bg-hover transition-colors"
              >
                No
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDeleteScene(chapterId, scene.id); }}
                className="bg-panel rounded px-2 py-1 text-[11px] tracking-[0.33px] uppercase text-text hover:bg-hover transition-colors"
              >
                Yes
              </button>
            </div>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
              className="opacity-0 group-hover/scene:opacity-100 text-subtle hover:text-error transition-all flex-shrink-0"
              title="Delete scene"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        )}

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
          className="w-full bg-transparent text-text text-manuscript-l font-serif indent-9 empty:indent-0 focus:outline-none empty:before:content-['Write_here…'] empty:before:text-subtle/30 empty:before:pointer-events-none [&_em]:italic"
          style={{ minHeight: "3em" }}
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
  loading = false,
  scenesVisible = true,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useAutoScrollOnDrag(scrollRef);
  const sceneReorder = useReorderList((from, to) => onReorderScenes(chapter.id, from, to));

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
      data-paste-scope="center"
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

      {/* Chapter Header — fixed h-16 so it matches the Book/Library Panel Headers;
          this keeps Cover, first Scene, and Gallery tops on the same baseline. */}
      <div className="h-16 flex items-center justify-center border-b border-border-subtle flex-shrink-0">
        <div className="w-full max-w-[700px] px-6">
          <input
            value={chapter.title}
            placeholder="Chapter title…"
            onChange={(e) => onChapterTitleChange(chapter.id, e.target.value)}
            className="w-full bg-transparent text-heading-l text-text placeholder:text-subtle/40 focus:outline-none"
          />
        </div>
      </div>

      {/* Scene feed */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="w-full max-w-[700px] mx-auto px-4 pt-4 pb-32">
          {loading ? (
            <div className="px-4" aria-hidden>
              {[0, 1, 2].map((i) => (
                <div key={i} className="mb-4 animate-pulse">
                  <div className="h-2.5 w-24 bg-panel rounded mb-3" />
                  <div className="h-3.5 w-full bg-panel rounded mb-2" />
                  <div className="h-3.5 w-11/12 bg-panel rounded mb-2" />
                  <div className="h-3.5 w-4/6 bg-panel rounded" />
                </div>
              ))}
            </div>
          ) : (
          <>
          {chapter.scenes.map((scene, i) => (
            <Fragment key={scene.id}>
              {scenesVisible && <DropLine active={sceneReorder.activeGap === i} />}
              <SceneBlock
                scene={scene}
                chapterId={chapter.id}
                index={i}
                onSceneChange={onSceneChange}
                dragHandleProps={sceneReorder.dragHandleProps}
                dropZoneProps={sceneReorder.dropZoneProps}
                onDeleteScene={onDeleteScene}
                scenesVisible={scenesVisible}
              />
            </Fragment>
          ))}
          {scenesVisible && <DropLine active={sceneReorder.activeGap === chapter.scenes.length} />}

          {/* Add scene button — hidden in the sceneless view */}
          {scenesVisible && (
          <button
            onClick={() => onAddScene(chapter.id)}
            className="mt-2 ml-4 mb-2 flex items-center gap-2 transition-colors group"
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
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}
