"use client";

import { Fragment, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import { Chapter, Scene, LibraryImage } from "@/lib/types";
import { SaveStatus } from "@/lib/useHotCocoaDb";
import { DropLine } from "@/components/ui/DropLine";
import SceneBlock from "@/components/SceneBlock";
import { useReorderList } from "@/lib/useReorderList";
import { useAutoScrollOnDrag } from "@/lib/useAutoScrollOnDrag";
import { useSceneDrag, SceneDragPayload } from "@/lib/useSceneDrag";

interface Props {
  chapter: Chapter;
  saveStatus: SaveStatus;
  onChapterTitleChange: (id: string, title: string) => void;
  onSceneChange: (chapterId: string, sceneId: string, patch: Partial<Scene>) => void;
  onAddScene: (chapterId: string) => void;
  onInsertScene: (chapterId: string, index: number) => void;
  onSplitChapter: (chapterId: string, index: number) => void;
  onReorderScenes: (chapterId: string, from: number, to: number) => void;
  onDeleteScene: (chapterId: string, sceneId: string) => void;
  onAddImage: (chapterId: string, img: LibraryImage) => void;
  loading?: boolean;
  scenesVisible?: boolean;
  // A request from the Book Panel to reveal a specific scene: scroll it into view
  // and place the caret in its body. `nonce` bumps on every click so re-clicking
  // the same scene re-fires. Self-guarded by scene id, so the panes that don't
  // hold the scene simply find nothing and no-op.
  scrollToScene?: { sceneId: string; nonce: number } | null;
  // ── Side-by-side ──
  // `focused` is undefined in ordinary single-editor Write mode, which suppresses
  // the focus rail entirely. In side-by-side both panes pass a boolean and the
  // rail cross-fades between them.
  focused?: boolean;
  onFocusPane?: () => void;
  // Only the second pane passes this; it renders the × that closes side-by-side.
  onClose?: () => void;
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

// Matches both the collapsible panels' fade and the fade step of the side-by-side
// enter/exit sequence in app/write, so the rail appearing and the pane appearing
// read as one motion.
const FOCUS_FADE_MS = 200;

// Hover-reveal row shown in the gap between two scenes (Figma "Hover Insert",
// 159:896): [+ Add scene] —— hairline —— [+ Split chapter]. At rest the gap is
// just the normal ~10px space between scenes (an invisible hover target). After
// a 300ms hover dwell it grows to ~16px and the row fades in — animated, and
// collapsing immediately on leave. The row floats centered and is only clickable
// once revealed, so it never intercepts clicks on the scenes around it.
function HoverInsert({ onAddScene, onSplit }: { onAddScene: () => void; onSplit: () => void }) {
  return (
    <div className="group/insert relative h-2.5 transition-[height] duration-200 hover:h-4 hover:delay-300">
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center gap-2 px-4 opacity-0 pointer-events-none transition-opacity duration-200 group-hover/insert:opacity-100 group-hover/insert:pointer-events-auto group-hover/insert:delay-300">
        <button
          onClick={onAddScene}
          className="flex items-center gap-1.5 flex-shrink-0 text-subtle hover:text-accent transition-colors"
        >
          <Image src="/plus.svg" alt="" width={16} height={16} className="opacity-60" />
          <span className="text-body-m whitespace-nowrap">Add scene</span>
        </button>
        <div className="flex-1 h-px bg-border-subtle" />
        <button
          onClick={onSplit}
          className="flex items-center gap-1.5 flex-shrink-0 text-subtle hover:text-accent transition-colors"
        >
          <Image src="/plus.svg" alt="" width={16} height={16} className="opacity-60" />
          <span className="text-body-m whitespace-nowrap">Split chapter</span>
        </button>
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
  onInsertScene,
  onSplitChapter,
  onReorderScenes,
  onDeleteScene,
  onAddImage,
  loading = false,
  scenesVisible = true,
  scrollToScene,
  focused,
  onFocusPane,
  onClose,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useAutoScrollOnDrag(scrollRef);

  // Reveal the scene the Book Panel asked for. Scoped to this pane's scroll
  // container, so only the pane actually rendering that scene reacts — the id is
  // unique across chapters, so the others' querySelector comes back empty. The
  // element's own scrollIntoView drives the smooth scroll; focusing the body then
  // drops the caret there (preventScroll so it doesn't fight the smooth scroll).
  const scrollNonce = scrollToScene?.nonce;
  const scrollSceneId = scrollToScene?.sceneId;
  useEffect(() => {
    if (!scrollSceneId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector<HTMLElement>(
      `[data-scene-id="${CSS.escape(scrollSceneId)}"]`
    );
    // offsetParent is null for a hidden pane (the mobile/desktop layout the
    // viewport isn't showing) — skip it so focus never lands off-screen.
    if (!el || el.offsetParent === null) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.querySelector<HTMLElement>('[contenteditable="true"]')?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollNonce]);
  const sceneReorder = useReorderList((from, to) => onReorderScenes(chapter.id, from, to));
  const sceneDrag = useSceneDrag();
  const prevPayload = useRef<SceneDragPayload | null>(null);
  useEffect(() => {
    if (prevPayload.current && !sceneDrag.payload) sceneReorder.reset();
    prevPayload.current = sceneDrag.payload;
  }, [sceneDrag.payload, sceneReorder.reset]);

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
      // Capture phase, so focusing the pane wins even when the click lands on a
      // child that stops propagation (scene buttons, the title input, etc.).
      // `onFocusCapture` covers keyboard traversal into the pane.
      onMouseDownCapture={onFocusPane}
      onFocusCapture={onFocusPane}
    >
      {/* Focus rail. Drawn as an overlay rather than a real border-top so that
          gaining or losing focus never reflows the chapter by 2px, and so it can
          fade on its own — a border-color transition would have to animate from
          the accent to transparent, which reads as a grey ghost on the way out. */}
      {focused !== undefined && (
        <div
          className="absolute inset-x-0 top-0 h-0.5 bg-accent z-30 pointer-events-none"
          style={{ opacity: focused ? 1 : 0, transition: `opacity ${FOCUS_FADE_MS}ms ease-in-out` }}
        />
      )}
      {/* Save indicator */}
      {saveStatus !== "idle" && (
        <div
          className={`absolute top-4 ${onClose ? "right-12" : "right-4"} text-[10px] uppercase tracking-widest transition-opacity z-10 ${
            saveStatus === "saving" || saveStatus === "offline"
              ? "text-subtle"
              : saveStatus === "error"
              ? "text-error"
              : "text-accent"
          }`}
        >
          {saveStatus === "saving"
            ? "Saving…"
            : saveStatus === "offline"
            ? "Offline — will sync"
            : saveStatus === "error"
            ? "Save failed — retrying…"
            : "Saved"}
        </div>
      )}

      {/* Chapter Header — fixed h-16 so it matches the Book/Library Panel Headers;
          this keeps Cover, first Scene, and Gallery tops on the same baseline. */}
      <div className="h-16 flex items-center justify-center border-b border-border-subtle flex-shrink-0 relative">
        <div className="w-full max-w-[700px] px-6">
          <input
            value={chapter.title}
            placeholder="Chapter title…"
            onChange={(e) => onChapterTitleChange(chapter.id, e.target.value)}
            className="w-full bg-transparent text-heading-l text-text placeholder:text-subtle/40 focus:outline-none"
          />
        </div>
        {/* Close side-by-side — second pane only. Sits at the column's right edge
            rather than inside the centred title container, per the design. */}
        {onClose && (
          <button
            onClick={onClose}
            className="absolute right-4 p-1 rounded text-subtle hover:text-text transition-colors"
            title="Close side-by-side"
            aria-label="Close side-by-side"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Scene feed */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto hc-scroll-hoverbar">
        <div className="w-full max-w-[700px] mx-auto pl-4 pr-1.5 pt-4 pb-32" {...sceneReorder.containerProps()}>
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
              {/* Hover-insert row in each gap between scenes (not before the
                  first). Always rendered so it also provides the resting ~10px
                  gap between scenes; its content only reveals on hover. */}
              {scenesVisible && i > 0 && (
                <HoverInsert
                  onAddScene={() => onInsertScene(chapter.id, i)}
                  onSplit={() => onSplitChapter(chapter.id, i)}
                />
              )}
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
