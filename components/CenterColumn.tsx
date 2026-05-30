"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import { Chapter, Scene, LibraryImage } from "@/lib/types";
import { SaveStatus } from "@/lib/useAkuko";

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
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }

  useEffect(() => {
    if (bodyRef.current) autoResize(bodyRef.current);
  }, [scene.body]);

  // When the wrapper div is clicked, only redirect to body if the click
  // didn't land on the label input itself.
  function handleWrapperClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === labelRef.current) return;
    bodyRef.current?.focus();
  }

  return (
    <div
      className={`rounded-lg px-4 py-3 mb-2 transition-colors cursor-text ${
        focused ? "bg-[#1f1f21]" : "bg-transparent hover:bg-[#1c1c1e]/50"
      }`}
      onClick={handleWrapperClick}
    >
      {/* Scene label — stop propagation so click stays here */}
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

      {/* Scene body */}
      <textarea
        ref={bodyRef}
        value={scene.body}
        placeholder="Write here…"
        rows={3}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          onSceneChange(chapterId, scene.id, { body: e.target.value });
          autoResize(e.target);
        }}
        className="w-full bg-transparent text-[#e8e6e3] text-sm leading-relaxed resize-none overflow-hidden placeholder:text-[#9b9890]/30 focus:outline-none"
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
      <div className="w-full flex justify-center border-b border-[#2a2a2c] flex-shrink-0">
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
            className="mt-2 ml-4 flex items-center gap-2 text-[#9b9890] hover:text-[#c4a882] text-xs transition-colors group"
          >
            <Image
              src="/plus.svg"
              alt="Add scene"
              width={16}
              height={16}
              className="opacity-40 group-hover:opacity-100 transition-opacity"
            />
            <span className="text-[10px] uppercase tracking-widest">Add scene</span>
          </button>
        </div>
      </div>
    </div>
  );
}
