"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import { Chapter, Scene, LibraryImage } from "@/lib/types";
import { SaveStatus } from "@/lib/useAkukoDb";

interface Props {
  chapter: Chapter;
  saveStatus: SaveStatus;
  onChapterTitleChange: (id: string, title: string) => void;
  onSceneChange: (chapterId: string, sceneId: string, patch: Partial<Scene>) => void;
  onAddScene: (chapterId: string) => void;
  onAddImage: (chapterId: string, img: LibraryImage) => void;
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function SceneBlock({
  scene,
  chapterId,
  onSceneChange,
}: {
  scene: Scene;
  chapterId: string;
  onSceneChange: (chapterId: string, sceneId: string, patch: Partial<Scene>) => void;
}) {
  const [focused, setFocused] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);

  // Set innerHTML on mount and when navigating to a different scene.
  // We intentionally don't re-sync on every scene.body change so the cursor
  // never jumps while the user is actively typing.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.innerHTML = scene.body;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.id]);

  function handleWrapperClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === labelRef.current) return;
    bodyRef.current?.focus();
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    // If clipboard contains an image, let it bubble up to CenterColumn
    // so it gets added to the library instead of pasted as text.
    const items = Array.from(e.clipboardData.items);
    if (items.some((it) => it.type.startsWith("image/"))) return;
    // Otherwise strip HTML — insert plain text only.
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Allow Cmd/Ctrl+I (italic). Block all other formatting shortcuts.
    if (
      (e.metaKey || e.ctrlKey) &&
      !["i", "z", "y", "a", "c", "x", "v"].includes(e.key.toLowerCase())
    ) {
      e.preventDefault();
    }
  }

  return (
    <div
      className={`rounded-lg px-4 py-3 mb-2 transition-colors cursor-text ${
        focused ? "bg-[#1f1f21]" : "bg-transparent hover:bg-[#1c1c1e]/50"
      }`}
      onClick={handleWrapperClick}
    >
      {/* Scene label */}
      <input
        ref={labelRef}
        maxLength={260}
        value={scene.label}
        placeholder="Scene label…"
        onChange={(e) =>
          onSceneChange(chapterId, scene.id, { label: e.target.value })
        }
        onClick={(e) => e.stopPropagation()}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="w-full bg-transparent text-[11px] font-medium tracking-wide uppercase text-[#6b6966] placeholder:text-[#6b6966]/50 mb-2 focus:outline-none cursor-text"
        style={{ fontFamily: "inherit" }}
      />

      {/* Scene body — contentEditable so Cmd+I italic works natively */}
      <div
        ref={bodyRef}
        contentEditable
        suppressContentEditableWarning
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onInput={() =>
          onSceneChange(chapterId, scene.id, {
            body: bodyRef.current?.innerHTML ?? "",
          })
        }
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        className="w-full bg-transparent text-[#e8e6e3] text-sm leading-relaxed focus:outline-none empty:before:content-['Write_here…'] empty:before:text-[#9b9890]/30 empty:before:pointer-events-none [&_em]:italic"
        style={{ fontFamily: "inherit", minHeight: "3em" }}
      />
    </div>
  );
}

export default function CenterColumn({
  chapter,
  saveStatus,
  onChapterTitleChange,
  onSceneChange,
  onAddScene,
  onAddImage,
}: Props) {
  // Clipboard paste → library image
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
      className="flex flex-col h-full bg-[#18181a] w-full relative"
      onPaste={handlePaste}
    >
      {/* Save indicator */}
      {saveStatus !== "idle" && (
        <div
          className={`absolute top-4 right-4 text-[10px] uppercase tracking-widest transition-opacity z-10 ${
            saveStatus === "saving" ? "text-[#9b9890]" : "text-[#c4a882]"
          }`}
        >
          {saveStatus === "saving" ? "Saving…" : "Saved"}
        </div>
      )}

      {/* Chapter title */}
      <div className="w-full flex justify-center border-b border-[#1f1f21] flex-shrink-0">
        <div className="w-full max-w-[700px] px-6 pt-6 pb-4">
          <input
            value={chapter.title}
            placeholder="Chapter title…"
            onChange={(e) => onChapterTitleChange(chapter.id, e.target.value)}
            className="w-full bg-transparent text-xl font-semibold text-[#e8e6e3] placeholder:text-[#9b9890]/40 focus:outline-none"
          />
        </div>
      </div>

      {/* Scene feed */}
      <div className="flex-1 overflow-y-auto flex justify-center">
        <div className="w-full max-w-[700px] px-4 py-4">
          {chapter.scenes.map((scene) => (
            <SceneBlock
              key={scene.id}
              scene={scene}
              chapterId={chapter.id}
              onSceneChange={onSceneChange}
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
            <span className="text-[11px] font-medium tracking-wide uppercase text-[#6b6966] group-hover:text-[#c4a882] transition-colors">Add scene</span>
          </button>
        </div>
      </div>
    </div>
  );
}
