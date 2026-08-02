"use client";

import { useState, useRef, useEffect } from "react";
import { Scene } from "@/lib/types";
import { useSceneDrag } from "@/lib/useSceneDrag";

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

interface SceneBlockProps {
  scene: Scene;
  chapterId: string;
  index: number;
  onSceneChange: (chapterId: string, sceneId: string, patch: Partial<Scene>) => void;
  // Reorder wiring — optional so the Book Info Synopsis (a single, fixed scene)
  // can render without any drag/drop plumbing.
  dragHandleProps?: (index: number) => React.HTMLAttributes<HTMLElement> & { draggable?: boolean };
  dropZoneProps?: (index: number) => React.HTMLAttributes<HTMLElement>;
  onDeleteScene?: (chapterId: string, sceneId: string) => void;
  scenesVisible?: boolean;
  // Book Info Synopsis variant: a static, non-editable description (e.g.
  // "Synopsis"), no drag surface, and no delete control. The body editor is
  // unchanged.
  fixedLabel?: string;
  placeholder?: string;
}

export default function SceneBlock({
  scene,
  chapterId,
  index,
  onSceneChange,
  dragHandleProps,
  dropZoneProps,
  onDeleteScene,
  scenesVisible = true,
  fixedLabel,
  placeholder,
}: SceneBlockProps) {
  const locked = fixedLabel !== undefined;
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

  const rowDrag = dragHandleProps ? dragHandleProps(index) : {};

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
      {...(dropZoneProps ? dropZoneProps(index) : {})}
      data-scene-id={scene.id}
      className={`rounded-lg transition-colors relative group/scene ${
        scenesVisible ? "" : "mb-2"
      } ${focused || editingLabel ? "bg-elevated" : "bg-transparent hover:bg-panel"}`}
    >
      <div className="px-4 py-3" onClick={handleWrapperClick}>
        {/* Scene Header: description label + delete (×/confirmation) on the right.
            The row itself is the drag handle for reordering — disabled while the
            scene is focused so the description text stays selectable. Hidden in the
            "sceneless" view (structure is untouched — just not shown). In the
            locked (Synopsis) variant the label is static and there's no delete. */}
        {scenesVisible && (
        <div className="flex items-center gap-2 mb-2 min-h-[1.5rem]">
          {locked ? (
            <span className="flex-1 min-w-0 truncate text-label-m uppercase text-subtle select-none">
              {fixedLabel}
            </span>
          ) : editingLabel ? (
            <input
              ref={labelRef}
              autoFocus
              maxLength={260}
              value={scene.label}
              placeholder="Scene description…"
              autoComplete="off"
              autoCorrect="on"
              autoCapitalize="sentences"
              data-1p-ignore
              data-lpignore="true"
              data-form-type="other"
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
          {!locked && (confirmDelete ? (
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
                onClick={(e) => { e.stopPropagation(); onDeleteScene?.(chapterId, scene.id); }}
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
          ))}
        </div>
        )}

        {/* Scene body */}
        <div
          ref={bodyRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          // Freeform prose: enable sentence-casing/autocorrect/spellcheck, and
          // opt out of autofill. iOS otherwise can't classify a bare
          // contentEditable and pops its password/card/contact AutoFill bar over
          // the keyboard (mis-reading the field as a credential input).
          autoCorrect="on"
          autoCapitalize="sentences"
          spellCheck
          // autoComplete isn't in React's div prop types (form-elements only),
          // but the DOM attribute is honored on contentEditable — spread it in.
          {...({ autoComplete: "off" } as Record<string, string>)}
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          onFocus={() => { setFocused(true); setConfirmDelete(false); }}
          onBlur={() => setFocused(false)}
          onInput={() => onSceneChange(chapterId, scene.id, { body: bodyRef.current?.innerHTML ?? "" })}
          onPaste={handlePaste}
          onCopy={handleCopy}
          onKeyDown={handleKeyDown}
          data-placeholder={placeholder ?? "Write here…"}
          className="w-full bg-transparent text-text text-manuscript-l font-serif indent-9 empty:indent-0 focus:outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-subtle/30 empty:before:pointer-events-none [&_em]:italic"
          style={{ minHeight: "3em" }}
        />
      </div>
    </div>
  );
}
