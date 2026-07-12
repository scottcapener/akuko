"use client";

import { Fragment, useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import { Chapter, Scene, LibraryImage } from "@/lib/types";
import { SaveStatus } from "@/lib/useHotCocoaDb";
import { DropLine } from "@/components/ui/DropLine";
import { useReorderList } from "@/lib/useReorderList";
import { useAutoScrollOnDrag } from "@/lib/useAutoScrollOnDrag";
import { useSceneDrag } from "@/lib/useSceneDrag";

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
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

// The scene body's first-line indent comes from a CSS class (`indent-9`, 36px)
// on the editor container, not from the markup itself — so copied HTML carries
// no indent and pastes flush-left into Google Docs / Word. `indentedParagraphHtml`
// rebuilds a copied selection into real <p> blocks, each carrying the indent
// inline, so the paragraph shape survives the paste. Matches `indent-9` (36px).
const SCENE_INDENT_PX = 36;

function escapeHtmlText(text: string): string {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

// Flatten a copied editor fragment into a list of paragraph inner-HTML strings.
// Handles both block-based line breaks (Chrome's <div> per line, incl. the
// <div><br></div> empty line) and inline <br> breaks (Firefox/Safari, Shift+Enter),
// while preserving inline formatting like <em>.
function collectParagraphs(root: Node): string[] {
  const paras: string[] = [];
  let current = "";
  let started = false;
  const flush = () => { paras.push(current); current = ""; started = false; };

  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      current += escapeHtmlText(node.textContent ?? "");
      started = true;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tag = el.tagName;
      if (tag === "BR") {
        flush();
      } else if (tag === "DIV" || tag === "P") {
        if (started) flush();
        collectParagraphs(el).forEach((p) => paras.push(p));
      } else {
        current += el.outerHTML;
        started = true;
      }
    }
  });
  if (started || paras.length === 0) flush();
  return paras;
}

function indentedParagraphHtml(fragment: DocumentFragment): string {
  const container = document.createElement("div");
  container.appendChild(fragment);
  const paras = collectParagraphs(container);
  if (paras.every((p) => p.trim() === "")) return "";
  return paras
    .map((p) => `<p style="margin:0;text-indent:${SCENE_INDENT_PX}px;">${p || "<br>"}</p>`)
    .join("");
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
  const [editingLabel, setEditingLabel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const sceneDrag = useSceneDrag();

  // Click-vs-drag on the description: the span is always draggable, so a
  // click-and-drag reliably starts a native drag (reorder). A genuine click
  // (no drag) still edits — the browser suppresses the `click` after a drag, and
  // `draggedRef` guards the rare case where it doesn't.
  const draggedRef = useRef(false);

  // Set innerHTML on mount and when navigating to a different scene.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.innerHTML = scene.body;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.id]);

  function handleLabelClick() {
    if (draggedRef.current) { draggedRef.current = false; return; }
    setEditingLabel(true);
  }

  const rowDrag = dragHandleProps(index);

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

  // Rewrite the clipboard so the CSS-only first-line indent survives a paste
  // into Google Docs / Word as a real per-paragraph indent. Plain text is left
  // as the selection's text so non-rich targets are unaffected.
  function handleCopy(e: React.ClipboardEvent<HTMLDivElement>) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const html = indentedParagraphHtml(sel.getRangeAt(0).cloneContents());
    if (!html) return;
    e.preventDefault();
    e.clipboardData.setData("text/html", html);
    e.clipboardData.setData("text/plain", sel.toString());
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    // Apply italic ourselves rather than relying on the browser default. Some
    // browsers (e.g. Firefox) bind Cmd/Ctrl+I to a chrome feature ("Page Info")
    // and never toggle italic in the editor. preventDefault suppresses that so
    // italics always wins, matching Google Docs' behavior.
    if (key === "i") {
      e.preventDefault();
      document.execCommand("italic");
      onSceneChange(chapterId, scene.id, { body: bodyRef.current?.innerHTML ?? "" });
      return;
    }
    // Block every other formatting shortcut; keep clipboard/undo/select-all.
    if (!["z", "y", "a", "c", "x", "v"].includes(key)) {
      e.preventDefault();
    }
  }

  // When scenes are visible the HoverInsert rows provide the inter-scene gap, so
  // the block needs no bottom margin; the sceneless view has no HoverInsert, so
  // it keeps its own spacing.
  return (
    <div
      {...dropZoneProps(index)}
      className={`rounded-lg transition-colors relative group/scene ${
        scenesVisible ? "" : "mb-2"
      } ${focused || editingLabel ? "bg-elevated" : "bg-transparent hover:bg-panel"}`}
    >
      <div className="px-4 py-3" onClick={handleWrapperClick}>
        {/* Scene Header: description label + delete (×/confirmation) on the right.
            The row itself is the drag handle for reordering — disabled while the
            scene is focused so the description text stays selectable. Hidden in the
            "sceneless" view (structure is untouched — just not shown). */}
        {scenesVisible && (
        <div className="flex items-center gap-2 mb-2 min-h-[1.5rem]">
          {editingLabel ? (
            <input
              ref={labelRef}
              autoFocus
              maxLength={260}
              value={scene.label}
              placeholder="Scene description…"
              onChange={(e) => onSceneChange(chapterId, scene.id, { label: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              onFocus={() => setFocused(true)}
              onBlur={() => { setFocused(false); setEditingLabel(false); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); }}
              className="flex-1 min-w-0 bg-transparent text-label-m uppercase text-subtle placeholder:text-subtle/40 focus:outline-none cursor-text"
              style={{ fontFamily: "inherit" }}
            />
          ) : (
            // Description as a drag surface: a plain click edits (see
            // handleLabelClick), a click-and-drag past the threshold reorders
            // and doubles as the cross-chapter drag source (shared payload).
            <span
              draggable
              onMouseDown={() => { draggedRef.current = false; }}
              onDragStart={(e) => {
                rowDrag.onDragStart?.(e);
                draggedRef.current = true;
                sceneDrag.begin({ sceneId: scene.id, fromChapterId: chapterId, fromIndex: index });
              }}
              onDragEnd={(e) => {
                rowDrag.onDragEnd?.(e);
                sceneDrag.end();
              }}
              onClick={(e) => { e.stopPropagation(); handleLabelClick(); }}
              title={scene.label || "Scene description…"}
              className={`flex-1 min-w-0 truncate text-label-m uppercase select-none active:cursor-grabbing cursor-grab ${
                scene.label ? "text-subtle" : "text-subtle/40"
              }`}
            >
              {scene.label || "Scene description…"}
            </span>
          )}
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
          onCopy={handleCopy}
          onKeyDown={handleKeyDown}
          className="w-full bg-transparent text-text text-manuscript-l font-serif indent-9 empty:indent-0 focus:outline-none empty:before:content-['Write_here…'] empty:before:text-subtle/30 empty:before:pointer-events-none [&_em]:italic"
          style={{ minHeight: "3em" }}
        />
      </div>
    </div>
  );
}

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
            saveStatus === "saving" ? "text-subtle" : saveStatus === "error" ? "text-error" : "text-accent"
          }`}
        >
          {saveStatus === "saving"
            ? "Saving…"
            : saveStatus === "error"
            ? "Save failed — retrying…"
            : "Saved"}
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
