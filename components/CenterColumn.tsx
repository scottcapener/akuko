"use client";

import { useState, useRef, useEffect } from "react";
import { Chapter, Scene } from "@/lib/types";
import { SaveStatus } from "@/lib/useAkuko";

interface Props {
  chapter: Chapter;
  saveStatus: SaveStatus;
  onChapterTitleChange: (id: string, title: string) => void;
  onSceneChange: (chapterId: string, sceneId: string, patch: Partial<Scene>) => void;
  onAddScene: (chapterId: string) => void;
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

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }

  useEffect(() => {
    if (bodyRef.current) autoResize(bodyRef.current);
  }, [scene.body]);

  return (
    <div
      className={`rounded-lg px-4 py-3 mb-2 transition-colors cursor-text ${
        focused ? "bg-[#1f1f21]" : "bg-transparent hover:bg-[#1c1c1e]/50"
      }`}
      onClick={() => bodyRef.current?.focus()}
    >
      {/* Scene label */}
      <input
        maxLength={260}
        value={scene.label}
        placeholder="Scene label…"
        onChange={(e) =>
          onSceneChange(chapterId, scene.id, { label: e.target.value })
        }
        className="w-full bg-transparent text-[10px] uppercase tracking-widest text-[#9b9890] placeholder:text-[#9b9890]/40 mb-2 focus:outline-none"
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
        className="w-full bg-transparent text-[#e8e6e3] text-sm leading-relaxed resize-none placeholder:text-[#9b9890]/30 focus:outline-none"
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
}: Props) {
  return (
    <div className="flex flex-col h-full bg-[#18181a] w-full relative">
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
      <div className="px-6 pt-6 pb-4 flex-shrink-0 border-b border-[#2a2a2c]">
        <input
          value={chapter.title}
          placeholder="Chapter title…"
          onChange={(e) => onChapterTitleChange(chapter.id, e.target.value)}
          className="w-full bg-transparent text-xl font-semibold text-[#e8e6e3] placeholder:text-[#9b9890]/40 focus:outline-none"
        />
      </div>

      {/* Scene feed */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
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
          <span className="w-5 h-5 rounded-full border border-current flex items-center justify-center group-hover:border-[#c4a882]">
            <svg
              className="w-3 h-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </span>
          <span className="text-[10px] uppercase tracking-widest">Add scene</span>
        </button>
      </div>
    </div>
  );
}
