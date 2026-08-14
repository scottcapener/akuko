"use client";

import { Fragment, useState, useRef, useEffect } from "react";
import type React from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Book, Section, Chapter, Scene } from "@/lib/types";
import { Button, Modal } from "@/components/ui";
import { DropLine } from "@/components/ui/DropLine";
import BookOverview from "@/components/BookOverview";
import { Badge } from "@/components/ui/Badge";
import { useUnread } from "@/lib/useUnread";
import { useTheme } from "@/lib/useTheme";
import { useReorderList } from "@/lib/useReorderList";
import { useReorderGrid } from "@/lib/useReorderGrid";
import { useAutoScrollOnDrag } from "@/lib/useAutoScrollOnDrag";
import { useSceneDrag } from "@/lib/useSceneDrag";
import { useChapterDrag } from "@/lib/useChapterDrag";

// Which gap a drag is hovering over an item: before it, or after it (based on
// whether the pointer is past the item's vertical midpoint). Mirrors the gap math
// in useReorderList so cross-chapter scene drops read identically.
function gapFromEvent(e: React.DragEvent, index: number): number {
  const rect = e.currentTarget.getBoundingClientRect();
  return e.clientY > rect.top + rect.height / 2 ? index + 1 : index;
}

interface Props {
  book: Book;
  sections: Section[];
  activeChapter: Chapter;
  onChapterClick: (id: string) => void;
  // Open the Book Info editor (clicking the Book Overview title). `bookInfoActive`
  // reflects that Book Info is the current center view.
  onOpenBookInfo: () => void;
  bookInfoActive?: boolean;
  // Click a scene row (list view, open chapter) to reveal it in the Chapter Editor.
  onSceneClick?: (chapterId: string, sceneId: string) => void;
  onCoverImage: (file: File | undefined, previewDataUrl?: string) => void;
  onRefreshCover?: () => void;
  onAddChapter: (sectionId: string) => void;
  onDeleteChapter: (chapterId: string) => void;
  onReorderChapters: (sectionId: string, from: number, to: number) => void;
  onMoveScene: (sceneId: string, fromChapterId: string, toChapterId: string, toIndex: number) => void;
  onMoveChapter: (chapterId: string, fromSectionId: string, toSectionId: string, toIndex: number) => void;
  onDuplicateChapter: (chapterId: string) => void;
  onAddSection: (afterSectionId: string) => void;
  onUpdateSectionLabel: (sectionId: string, label: string) => void;
  onReorderSections: (from: number, to: number) => void;
  onDeleteSection: (sectionId: string) => void;
  scenesVisible: boolean;
  onToggleScenes: () => void;
  linksVisible: boolean;
  onToggleLinks: () => void;
  sectionViews: Record<string, "grid" | "list">;
  onSetSectionView: (sectionId: string, view: "grid" | "list") => void;
  // ── Side-by-side ──
  // The chapter open in the second Chapter Editor, or null when side-by-side is
  // off. `activeChapter` is always pane 1's chapter.
  secondaryChapterId?: string | null;
  focusedPane?: 1 | 2;
  onOpenSideBySide?: (chapterId: string) => void;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  // Pixel width of the expanded panel — the body below the header renders at
  // this fixed width always (see the body wrapper below) so collapsing never
  // visibly resizes its contents; only the enclosing column's overflow-hidden
  // width and this fade change.
  expandedWidth?: number;
  // Optional content floated over the bottom of the chapter list (the Tips card).
  // Passed only by the desktop writer instance so the card renders exactly once.
  overlay?: React.ReactNode;
}

// ── Confirmation modal ────────────────────────────────────────────────────────

function ConfirmModal({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  extra,
}: {
  message: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <Modal onClose={onCancel} maxWidth="max-w-sm" backdrop="dark">
      <div className="p-5 flex flex-col gap-4">
        <p className="text-sm text-text leading-relaxed">{message}</p>
        {extra}
        <div className="flex items-center gap-3">
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg bg-red-900/40 text-error text-xs font-semibold hover:bg-red-900/60 transition-colors"
          >
            {confirmLabel}
          </button>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Pane badge ────────────────────────────────────────────────────────────────

// The "1"/"2" bubble marking which Chapter Editor a chapter is currently open in
// while side-by-side is active. Colour tracks focus — accent for the focused
// pane, subtle for the other — matching the chapter cell/row's own border.
function PaneBubble({ pane, focused, className = "" }: { pane: 1 | 2; focused: boolean; className?: string }) {
  return (
    <span
      className={`w-[15px] h-[15px] flex-shrink-0 rounded-full flex items-center justify-center text-[9px] font-semibold leading-none ${
        focused ? "bg-accent text-text" : "bg-subtle text-muted"
      } ${className}`}
      title={`Open in Chapter Editor ${pane}`}
    >
      {pane}
    </span>
  );
}

// ── Animated scene list ─────────────────────────────────────────────────────

// Wraps a chapter's scene list (list view) so switching the active chapter
// animates instead of snapping. Height collapses/expands via the grid-rows
// 0fr⇄1fr trick (animatable, unlike height:auto) and the content fades, with
// the two phases staggered per the choreography:
//   closing → fade out (0–200ms), then collapse (200–400ms)
//   opening → expand (0–200ms), then fade in (200–400ms)
// `enterDelay` pushes the opening chapter's phases later so it waits out the
// previously-active chapter's fade-out — the two heights then animate together.
// During a scene drag (`animate` false) and under prefers-reduced-motion, it
// falls back to instant show/hide so drop targeting stays snappy. Content is
// mounted only while open, kept mounted through the collapse (unmounted on
// transition end) or while it hosts the dragged scene (`keepMounted`).
function ChapterScenes({
  open,
  keepMounted,
  animate,
  enterDelay,
  children,
}: {
  open: boolean;
  keepMounted: boolean;
  animate: boolean;
  enterDelay: number;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(open || keepMounted);
  const [shown, setShown] = useState(open);
  const [reduce, setReduce] = useState(false);
  const rafRef = useRef<number | null>(null);
  const prevOpenRef = useRef(open);

  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(m.matches);
    const onChange = () => setReduce(m.matches);
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, []);

  const doAnimate = animate && !reduce;

  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    const cancelRaf = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };

    if (open && !wasOpen) {
      // Enter: mount closed, then flip to open on the next frame so the
      // grid-rows/opacity transition has a "from" state to animate off.
      setMounted(true);
      if (doAnimate) {
        setShown(false);
        cancelRaf();
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = requestAnimationFrame(() => setShown(true));
        });
      } else {
        setShown(true);
      }
    } else if (!open && wasOpen) {
      // Exit: animate closed (unmount on transitionend) or hide instantly.
      cancelRaf();
      setShown(false);
      if (!doAnimate && !keepMounted) setMounted(false);
    } else if (open) {
      // Stayed open (e.g. animate toggled off/on mid-life) — settle to shown.
      cancelRaf();
      setShown(true);
      setMounted(true);
    }
    return cancelRaf;
  }, [open, doAnimate, keepMounted]);

  // A drag source must stay mounted even while its list is collapsed.
  useEffect(() => {
    if (keepMounted) setMounted(true);
  }, [keepMounted]);

  if (!mounted) return null;

  return (
    <div
      className="grid min-h-0"
      style={{
        gridTemplateRows: shown ? "1fr" : "0fr",
        transition: doAnimate
          ? `grid-template-rows 200ms ease ${open ? enterDelay : 200}ms`
          : "none",
      }}
      onTransitionEnd={(e) => {
        // Only the outer row-height collapse finishing should unmount; ignore
        // the inner opacity fade and any child transitions bubbling up.
        if (
          e.propertyName === "grid-template-rows" &&
          e.currentTarget === e.target &&
          !open &&
          !keepMounted
        ) {
          setMounted(false);
        }
      }}
    >
      <div
        className="min-h-0 overflow-hidden"
        style={{
          opacity: shown ? 1 : 0,
          transition: doAnimate
            ? `opacity 200ms ease ${open ? enterDelay + 200 : 0}ms`
            : "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ── Section row ───────────────────────────────────────────────────────────────

function SectionRow({
  section,
  sectionIndex,
  sectionCount,
  activeChapter,
  secondaryChapterId,
  focusedPane,
  onChapterClick,
  onSceneClick,
  onAddChapter,
  onDeleteChapterRequest,
  onReorderChapters,
  onMoveScene,
  onMoveChapter,
  onDuplicateChapter,
  onOpenChapterMenu,
  onAddSection,
  onUpdateSectionLabel,
  onMoveSection,
  onDeleteSectionRequest,
  sectionDragProps,
  view,
  onSetView,
  scenesVisible,
  dropChapterId,
  dropGap,
  setSceneDropTarget,
  clearSceneDropTarget,
  chapterDrop,
  setChapterDropTarget,
  clearChapterDropTarget,
}: {
  section: Section;
  sectionIndex: number;
  sectionCount: number;
  activeChapter: Chapter | undefined;
  secondaryChapterId: string | null;
  focusedPane: 1 | 2;
  onChapterClick: (id: string) => void;
  onSceneClick?: (chapterId: string, sceneId: string) => void;
  onAddChapter: (sectionId: string) => void;
  onDeleteChapterRequest: (chapter: Chapter) => void;
  onReorderChapters: (sectionId: string, from: number, to: number) => void;
  onMoveScene: (sceneId: string, fromChapterId: string, toChapterId: string, toIndex: number) => void;
  onMoveChapter: (chapterId: string, fromSectionId: string, toSectionId: string, toIndex: number) => void;
  onDuplicateChapter: (chapterId: string) => void;
  onOpenChapterMenu: (chapter: Chapter, x: number, y: number) => void;
  onAddSection: (afterSectionId: string) => void;
  onUpdateSectionLabel: (sectionId: string, label: string) => void;
  onMoveSection: (from: number, to: number) => void;
  onDeleteSectionRequest: (section: Section) => void;
  sectionDragProps: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
  view: "grid" | "list";
  onSetView: (sectionId: string, view: "grid" | "list") => void;
  scenesVisible: boolean;
  // Shared scene-drop state (lifted to LeftColumn so only one chapter is "open"
  // for a drop at a time, across all sections). dropChapterId is the chapter the
  // scene will land in; dropGap is the insertion index within it.
  dropChapterId: string | null;
  dropGap: number | null;
  setSceneDropTarget: (chapterId: string, gap: number) => void;
  clearSceneDropTarget: () => void;
  // Shared cross-section chapter-drop target (lifted like the scene one).
  chapterDrop: { sectionId: string; gap: number } | null;
  setChapterDropTarget: (sectionId: string, gap: number) => void;
  clearChapterDropTarget: () => void;
}) {
  const activeChapterId = activeChapter?.id ?? "";
  // The active chapter from the previous render — used to sequence the scene-list
  // animation: when the active chapter changes, the newly-opened list waits for
  // the previously-open one to finish collapsing (see ChapterScenes.enterDelay).
  const prevActiveIdRef = useRef(activeChapterId);
  const prevActiveId = prevActiveIdRef.current;
  useEffect(() => {
    prevActiveIdRef.current = activeChapterId;
  });
  // The opening list waits out only the fade-out (200ms) so its expand runs
  // concurrently with the previous list's collapse, then its scenes fade in:
  //   1. fade out old scenes  2. collapse + expand together  3. fade in new scenes
  const HANDOFF_DELAY = 200;
  // Which Chapter Editor a chapter is open in, or null if it isn't open. Outside
  // side-by-side only pane 1 ever matches, so every chapter-styling rule below
  // reduces to the old active/inactive split.
  const paneOf = (chapterId: string): 1 | 2 | null =>
    chapterId === activeChapterId ? 1 : chapterId && chapterId === secondaryChapterId ? 2 : null;
  const sideBySide = secondaryChapterId != null;
  const sceneDrag = useSceneDrag();
  const chapterDrag = useChapterDrag();
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(section.label);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Chapter reorder — grid view uses cell highlighting, list view an insertion
  // line. Both hooks are created unconditionally; only one is used per render.
  const chapterGrid = useReorderGrid((from, to) => onReorderChapters(section.id, from, to));
  const chapterList = useReorderList((from, to) => onReorderChapters(section.id, from, to));

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  useEffect(() => {
    setLabelDraft(section.label);
  }, [section.label]);

  function commitLabel() {
    setEditingLabel(false);
    const trimmed = labelDraft.trim() || "Untitled";
    if (trimmed !== section.label) onUpdateSectionLabel(section.id, trimmed);
  }

  // ── Scene drag/drop within the Book Panel ─────────────────────────────
  // Every rendered scene (list view) is a drag source carrying the shared
  // payload, so it can be dropped on any chapter here or reordered in place.
  function sceneSourceProps(scene: Scene, chapterId: string, index: number) {
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = "move";
        sceneDrag.begin({ sceneId: scene.id, fromChapterId: chapterId, fromIndex: index });
      },
      onDragEnd: () => sceneDrag.end(),
    };
  }

  function dropSceneInto(chapterId: string, gap: number) {
    const p = sceneDrag.peek();
    if (p) onMoveScene(p.sceneId, p.fromChapterId, chapterId, gap);
    clearSceneDropTarget();
    sceneDrag.end();
  }

  // ── Chapter drag/drop (reorder in-section + move across sections) ──────
  // Composes with the per-section reorder hook (chapterList/chapterGrid): the
  // hook handles same-section reorder; the shared chapterDrag payload lets a
  // chapter be dropped into a *different* section.
  const chapterFromOther = !!chapterDrag.payload && chapterDrag.payload.fromSectionId !== section.id;

  function chapterDragStart(e: React.DragEvent, hookStart: ((e: React.DragEvent) => void) | undefined, index: number) {
    hookStart?.(e);
    chapterDrag.begin({ chapterId: section.chapters[index].id, fromSectionId: section.id, fromIndex: index });
  }
  function chapterDragEnd(e: React.DragEvent, hookEnd: ((e: React.DragEvent) => void) | undefined) {
    hookEnd?.(e);
    chapterDrag.end();
  }
  function dropChapterInto(gap: number) {
    const p = chapterDrag.peek();
    if (p) onMoveChapter(p.chapterId, p.fromSectionId, section.id, gap);
    clearChapterDropTarget();
    chapterDrag.end();
  }
  // Insertion line for an incoming cross-section chapter drop into THIS section.
  const chapterDropGap = chapterFromOther && chapterDrop?.sectionId === section.id ? chapterDrop.gap : null;

  return (
    <div {...sectionDragProps} className="mb-4">
      {/* Section header row */}
      <div className="flex items-center gap-1 mb-2 group/section">
        {editingLabel ? (
          <input
            autoFocus
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitLabel();
              if (e.key === "Escape") { setLabelDraft(section.label); setEditingLabel(false); }
            }}
            className="flex-1 bg-transparent text-[11px] font-medium tracking-wide uppercase text-text focus:outline-none border-b border-accent min-w-0"
          />
        ) : (
          <button
            onClick={() => { setLabelDraft(section.label); setEditingLabel(true); }}
            className="flex-1 text-left text-[11px] font-medium tracking-wide uppercase text-subtle hover:text-text transition-colors truncate min-w-0"
          >
            {section.label}
          </button>
        )}

        {/* Add section below */}
        <button
          onClick={() => onAddSection(section.id)}
          className="opacity-40 hover:opacity-100 transition-opacity flex-shrink-0"
          title="Add section below"
        >
          <Image src="/plus.svg" alt="Add section" width={12} height={12} />
        </button>

        {/* View toggle — grid ⇄ list, per section. Shows the icon of the mode you
            switch *to*, so a single always-visible button covers both directions. */}
        <button
          onClick={() => onSetView(section.id, view === "grid" ? "list" : "grid")}
          className="opacity-40 hover:opacity-100 transition-opacity flex-shrink-0 text-subtle hover:text-text"
          title={view === "grid" ? "List view" : "Grid view"}
        >
          {view === "grid" ? (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6h16.5M3.75 12h16.5M3.75 18h16.5" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z" />
            </svg>
          )}
        </button>

        {/* Section options — kebab menu. Only rendered when deletion is possible
            (the last remaining section can't be deleted, so there'd be nothing to
            show). Its one item opens the Delete-section confirmation modal. */}
        {sectionCount > 1 && (
          <div ref={menuRef} className="relative flex-shrink-0">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="opacity-40 hover:opacity-100 transition-opacity flex items-center text-subtle hover:text-text"
              title="Section options"
              aria-label="Section options"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="12" cy="19" r="1.5" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-36 bg-panel border border-hover rounded-lg shadow-lg overflow-hidden z-20">
                <button
                  disabled={sectionIndex === 0}
                  onClick={() => { setMenuOpen(false); onMoveSection(sectionIndex, sectionIndex - 1); }}
                  className="block w-full text-left px-4 py-2.5 text-xs text-text hover:bg-hover transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-default"
                >
                  Move up
                </button>
                <button
                  disabled={sectionIndex === sectionCount - 1}
                  onClick={() => { setMenuOpen(false); onMoveSection(sectionIndex, sectionIndex + 1); }}
                  className="block w-full text-left px-4 py-2.5 text-xs text-text hover:bg-hover transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-default"
                >
                  Move down
                </button>
                <div className="h-px bg-hover" />
                <button
                  onClick={() => { setMenuOpen(false); onDeleteSectionRequest(section); }}
                  className="block w-full text-left px-4 py-2.5 text-xs text-error hover:bg-hover transition-colors"
                >
                  Delete section
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Chapter grid */}
      {view === "grid" ? (
      <div className="grid grid-cols-3 gap-1.5">
        {section.chapters.map((ch, i) => {
          const cell = chapterGrid.cellProps(i);
          // A scene drag can't be shown between scenes in grid view, so a cell
          // just accepts a drop that appends the scene to that chapter.
          const isSceneDropChap = !!sceneDrag.payload && dropChapterId === ch.id;
          const pane = paneOf(ch.id);
          const paneFocused = pane === focusedPane;
          return (
          <div key={ch.id} className="relative group/chapter">
            <button
              draggable={cell.draggable}
              onDragStart={(e) => chapterDragStart(e, cell.onDragStart, i)}
              onDragEnd={(e) => chapterDragEnd(e, cell.onDragEnd)}
              onDragLeave={cell.onDragLeave}
              onDragOver={(e) => {
                if (sceneDrag.payload) { e.preventDefault(); setSceneDropTarget(ch.id, ch.scenes.length); return; }
                if (chapterFromOther) { e.preventDefault(); setChapterDropTarget(section.id, i); return; }
                cell.onDragOver(e);
              }}
              onDrop={(e) => {
                if (sceneDrag.payload) { e.preventDefault(); e.stopPropagation(); dropSceneInto(ch.id, ch.scenes.length); return; }
                if (chapterFromOther) { e.preventDefault(); e.stopPropagation(); dropChapterInto(i); return; }
                cell.onDrop(e);
              }}
              onContextMenu={(e) => { e.preventDefault(); onOpenChapterMenu(ch, e.clientX, e.clientY); }}
              onClick={() => onChapterClick(ch.id)}
              className={`
                w-full aspect-[3/4] rounded text-[9px] font-medium text-center
                flex items-center justify-center px-1
                transition-colors truncate leading-tight
                ${chapterGrid.overIndex === i || isSceneDropChap || chapterDropGap === i ? "ring-2 ring-accent" : ""}
                ${pane
                  ? `bg-elevated text-muted border-[1.5px] ${
                      sideBySide && paneFocused ? "border-accent" : "border-subtle"
                    }`
                  : "bg-panel text-subtle hover:bg-hover hover:text-text"
                }
              `}
              title={ch.title}
            >
              <span className="truncate w-full text-center leading-tight">{ch.title}</span>
            </button>

            {/* Pane bubble — centred on the cell's right edge, overhanging the top
                by 5px. Occupies the same corner as the hover-× below, so the two
                are mutually exclusive; an open chapter stays deletable via the
                right-click menu. */}
            {sideBySide && pane && (
              <PaneBubble
                pane={pane}
                focused={paneFocused}
                className="absolute -top-[5px] -right-[7.5px] z-10"
              />
            )}

            {/* Circle-× delete on hover */}
            {!(sideBySide && pane) && (
            <button
              onClick={(e) => { e.stopPropagation(); onDeleteChapterRequest(ch); }}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-bg border border-hover items-center justify-center hidden group-hover/chapter:flex text-subtle hover:text-error hover:border-error/40 transition-colors z-10"
              title="Delete chapter"
            >
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            )}
          </div>
          );
        })}

        {/* Add chapter — also the append drop target for a cross-section chapter */}
        <button
          onClick={() => onAddChapter(section.id)}
          onDragOver={chapterFromOther ? (e) => { e.preventDefault(); setChapterDropTarget(section.id, section.chapters.length); } : undefined}
          onDrop={chapterFromOther ? (e) => { e.preventDefault(); e.stopPropagation(); dropChapterInto(section.chapters.length); } : undefined}
          className={`aspect-[3/4] rounded bg-panel text-subtle hover:bg-hover hover:text-accent transition-colors flex items-center justify-center ${
            chapterDropGap === section.chapters.length ? "ring-2 ring-accent" : ""
          }`}
          title="Add chapter"
        >
          <Image src="/plus.svg" alt="Add chapter" width={14} height={14} className="opacity-50 hover:opacity-100 transition-opacity" />
        </button>
      </div>
      ) : (
      /* Chapter list — active chapter expands to show its scene descriptions */
      /* containerProps catches drops that land on an insertion line: the line has
         no handler of its own, so without this the drop bubbles to the section
         wrapper's dropZone, which bails (its drag ref is null during a chapter
         drag) and never preventDefaults — leaving the line inert. */
      <div className="flex flex-col gap-0.5" {...chapterList.containerProps()}>
        {section.chapters.map((ch, i) => {
          const pane = paneOf(ch.id);
          const paneFocused = pane === focusedPane;
          // In side-by-side BOTH open chapters get the open treatment (border +
          // expanded scenes); only the border/bubble colour distinguishes focus.
          const isActive = pane !== null;
          const chDrop = chapterList.dropZoneProps(i);
          const sceneActive = !!sceneDrag.payload;
          // Which chapter's scenes are VISUALLY open: while a scene is dragged only
          // the hovered target (falling back to the active chapter until one is
          // hovered) so the source list "closes" — that keeps cross-chapter drop
          // targeting unambiguous (a hidden source isn't a competing target).
          const visualOpen = scenesVisible && (
            sceneActive ? (dropChapterId ? dropChapterId === ch.id : isActive) : isActive
          );
          // The source chapter's list stays MOUNTED (just hidden when it isn't the
          // visual target) so the dragged row never unmounts mid-drag — otherwise
          // its dragend wouldn't fire and the target would stay stuck highlighted.
          const isDragSource = sceneActive && sceneDrag.payload?.fromChapterId === ch.id;
          // A list opening because the active chapter switched waits for the
          // previously-active list to finish collapsing; opening from a scenes-
          // toggle or a side-by-side pane (no chapter is closing) starts at once.
          const sceneEnterDelay =
            !sceneActive && prevActiveId && prevActiveId !== activeChapterId && ch.id !== prevActiveId
              ? HANDOFF_DELAY
              : 0;
          // The chapter under the cursor right now — shows the accent insertion
          // line/ring and receives the drop.
          const isDropTarget = sceneActive && dropChapterId === ch.id;
          const chDragHandle = chapterList.dragHandleProps(i);
          return (
          <div key={ch.id}>
            <DropLine active={chapterList.activeGap === i || chapterDropGap === i} />
            {/* Chapter row — styled like a Note list item (icon + text + hover-reveal delete) */}
            <div
              {...chDragHandle}
              onDragStart={(e) => chapterDragStart(e, chDragHandle.onDragStart, i)}
              onDragEnd={(e) => chapterDragEnd(e, chDragHandle.onDragEnd)}
              onDragOver={(e) => {
                // A scene drag opens this chapter and targets the bottom; a
                // cross-section chapter drag inserts here; a same-section chapter
                // reorder falls through to the list hook.
                if (sceneDrag.payload) { e.preventDefault(); setSceneDropTarget(ch.id, ch.scenes.length); return; }
                if (chapterFromOther) { e.preventDefault(); setChapterDropTarget(section.id, gapFromEvent(e, i)); return; }
                chDrop.onDragOver(e);
              }}
              onDrop={(e) => {
                if (sceneDrag.payload) { e.preventDefault(); e.stopPropagation(); dropSceneInto(ch.id, dropGap ?? ch.scenes.length); return; }
                if (chapterFromOther) { e.preventDefault(); e.stopPropagation(); dropChapterInto(gapFromEvent(e, i)); return; }
                chDrop.onDrop(e);
              }}
              onContextMenu={(e) => { e.preventDefault(); onOpenChapterMenu(ch, e.clientX, e.clientY); }}
              onClick={() => onChapterClick(ch.id)}
              title={ch.title}
              className={`flex items-center gap-2 group/chapter px-2 py-1.5 rounded transition-colors cursor-pointer ${
                isDropTarget ? "ring-1 ring-accent" : ""
              } ${isActive
                ? `bg-elevated border ${sideBySide && paneFocused ? "border-accent" : "border-subtle"}`
                : "hover:bg-panel"}`}
            >
              {/* Chapter marker — a small rectangle echoing the grid-view cell:
                  active gets a border + fill, inactive is a solid fill. */}
              <span className="w-3.5 flex-shrink-0 flex items-center justify-center" aria-hidden>
                <span className={`w-2.5 h-3.5 rounded-[2px] ${
                  isActive ? "bg-subtle" : "bg-subtle/50"
                }`} />
              </span>
              <span className={`text-xs flex-1 truncate ${
                ch.title ? "text-text" : "text-subtle/35 italic"
              }`}>
                {ch.title || "Untitled chapter"}
              </span>
              {/* Pane bubble sits inside the row at its right edge. Like grid view
                  it replaces the hover-× for an open chapter (delete stays on the
                  right-click menu). */}
              {sideBySide && pane ? (
                <PaneBubble pane={pane} focused={paneFocused} />
              ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onDeleteChapterRequest(ch); }}
                className="hidden group-hover/chapter:flex text-subtle hover:text-error transition-colors flex-shrink-0"
                title="Delete chapter"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              )}
            </div>

            {/* Scene descriptions — nested under the chapter, text-only, tightly
                spaced. Each is a drag source; while this chapter is the drop
                target, they're also drop zones with insertion lines. The source
                chapter stays mounted but `hidden` while another chapter is the
                target, so its dragged row stays alive without being a drop target. */}
            <ChapterScenes
              open={visualOpen}
              keepMounted={isDragSource}
              animate={!sceneActive}
              enterDelay={sceneEnterDelay}
            >
              <div
                className="flex flex-col"
                // Catch drops that land on the insertion line in a gap (the line
                // has no drop handler; its events bubble here). Scene rows
                // stopPropagation, so row drops are handled by the row instead.
                onDragOver={sceneActive ? (e) => { if (!sceneDrag.payload) return; e.preventDefault(); } : undefined}
                onDrop={sceneActive ? (e) => { e.preventDefault(); e.stopPropagation(); dropSceneInto(ch.id, dropGap ?? ch.scenes.length); } : undefined}
              >
                {ch.scenes.length === 0 ? (
                  <div
                    onDragOver={sceneActive ? (e) => { if (!sceneDrag.payload) return; e.preventDefault(); setSceneDropTarget(ch.id, 0); } : undefined}
                    onDrop={sceneActive ? (e) => { e.preventDefault(); e.stopPropagation(); dropSceneInto(ch.id, 0); } : undefined}
                  >
                    {isDropTarget && <DropLine active={dropGap === 0} className="pl-8" />}
                    <p className="text-xs text-subtle/40 italic pl-8 py-0.5">No scenes yet</p>
                  </div>
                ) : (
                  <>
                    {ch.scenes.map((scene, si) => (
                      <Fragment key={scene.id}>
                        {isDropTarget && <DropLine active={dropGap === si} className="pl-8" />}
                        <div
                          {...sceneSourceProps(scene, ch.id, si)}
                          onClick={() => onSceneClick?.(ch.id, scene.id)}
                          onDragOver={sceneActive ? (e) => { if (!sceneDrag.payload) return; e.preventDefault(); setSceneDropTarget(ch.id, gapFromEvent(e, si)); } : undefined}
                          onDrop={sceneActive ? (e) => { e.preventDefault(); e.stopPropagation(); dropSceneInto(ch.id, dropGap ?? gapFromEvent(e, si)); } : undefined}
                          title={scene.label || "Untitled scene"}
                          className="group/scene px-2 py-0.5 pl-8 cursor-pointer active:cursor-grabbing"
                        >
                          <span className={`block text-xs truncate transition-colors group-hover/scene:text-muted ${
                            scene.label ? "text-subtle" : "text-subtle/35 italic"
                          }`}>
                            {scene.label || "Untitled scene"}
                          </span>
                        </div>
                      </Fragment>
                    ))}
                    {isDropTarget && <DropLine active={dropGap === ch.scenes.length} className="pl-8" />}
                  </>
                )}
              </div>
            </ChapterScenes>
          </div>
          );
        })}
        <DropLine active={chapterList.activeGap === section.chapters.length || chapterDropGap === section.chapters.length} />

        {/* Add chapter — also the append drop target for a cross-section chapter */}
        <button
          onClick={() => onAddChapter(section.id)}
          onDragOver={chapterFromOther ? (e) => { e.preventDefault(); setChapterDropTarget(section.id, section.chapters.length); } : undefined}
          onDrop={chapterFromOther ? (e) => { e.preventDefault(); e.stopPropagation(); dropChapterInto(section.chapters.length); } : undefined}
          className="mt-0.5 flex items-center gap-2 rounded px-2 py-1.5 text-subtle hover:bg-hover hover:text-accent transition-colors"
          title="Add chapter"
        >
          <Image src="/plus.svg" alt="Add chapter" width={12} height={12} className="opacity-50" />
          <span className="text-xs">Add chapter</span>
        </button>
      </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LeftColumn({
  book,
  sections,
  activeChapter,
  onChapterClick,
  onSceneClick,
  onOpenBookInfo,
  bookInfoActive = false,
  onCoverImage,
  onRefreshCover,
  onAddChapter,
  onDeleteChapter,
  onReorderChapters,
  onMoveScene,
  onMoveChapter,
  onDuplicateChapter,
  onAddSection,
  onUpdateSectionLabel,
  onReorderSections,
  onDeleteSection,
  scenesVisible,
  onToggleScenes,
  linksVisible,
  onToggleLinks,
  sectionViews,
  onSetSectionView,
  secondaryChapterId = null,
  focusedPane = 1,
  onOpenSideBySide,
  onClose,
  collapsed,
  onToggleCollapse,
  expandedWidth,
  overlay,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const { theme, toggleTheme } = useTheme();
  const { total: unreadTotal } = useUnread();

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDeleteSection, setConfirmDeleteSection] = useState<Section | null>(null);
  const [confirmDeleteChapter, setConfirmDeleteChapter] = useState<Chapter | null>(null);
  // Is the chapter pending deletion currently shared? (§7) When it is, the
  // delete modal offers to also stop sharing; otherwise the snapshot + comments
  // survive the live-chapter delete (chapter_id FK → null).
  const [deleteChapterShared, setDeleteChapterShared] = useState(false);
  const [alsoStopSharing, setAlsoStopSharing] = useState(false);
  useEffect(() => {
    setAlsoStopSharing(false);
    setDeleteChapterShared(false);
    const chapter = confirmDeleteChapter;
    if (!chapter) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/share?chapterId=${encodeURIComponent(chapter.id)}`);
        if (!res.ok || cancelled) return;
        const state = await res.json();
        if (!cancelled) setDeleteChapterShared(!!state.shared);
      } catch {
        // Leave it as "not shared" — the checkbox just won't offer.
      }
    })();
    return () => { cancelled = true; };
  }, [confirmDeleteChapter]);

  const menuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useAutoScrollOnDrag(scrollRef);
  const sectionReorder = useReorderList(onReorderSections);

  // Shared scene-drop target across every section, so at most one chapter's
  // scene list is open for a drop at a time. Cleared whenever a scene drag ends.
  const sceneDrag = useSceneDrag();
  const [dropChapterId, setDropChapterId] = useState<string | null>(null);
  const [dropGap, setDropGap] = useState<number | null>(null);
  const setSceneDropTarget = (chapterId: string, gap: number) => {
    setDropChapterId(chapterId);
    setDropGap(gap);
  };
  const clearSceneDropTarget = () => {
    setDropChapterId(null);
    setDropGap(null);
  };
  useEffect(() => {
    if (!sceneDrag.payload) clearSceneDropTarget();
  }, [sceneDrag.payload]);

  // Shared cross-section chapter-drop target (mirrors the scene one). Only one
  // section shows an incoming chapter's insertion line at a time.
  const chapterDrag = useChapterDrag();
  const [chapterDrop, setChapterDrop] = useState<{ sectionId: string; gap: number } | null>(null);
  const setChapterDropTarget = (sectionId: string, gap: number) => setChapterDrop({ sectionId, gap });
  const clearChapterDropTarget = () => setChapterDrop(null);
  useEffect(() => {
    if (!chapterDrag.payload) clearChapterDropTarget();
  }, [chapterDrag.payload]);

  // Right-click chapter menu (Duplicate / Delete), positioned at the cursor.
  const [chapterMenu, setChapterMenu] = useState<{ chapter: Chapter; x: number; y: number } | null>(null);
  const openChapterMenu = (chapter: Chapter, x: number, y: number) => setChapterMenu({ chapter, x, y });
  const chapterMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!chapterMenu) return;
    const close = () => setChapterMenu(null);
    // Close on outside interaction only. A mousedown INSIDE the menu must not
    // close it: React would unmount the item before the click landed, so the
    // item's onClick never ran. The container's onMouseDown stopPropagation
    // can't prevent this — React delegates from the same node this listener is
    // on, and stopPropagation doesn't stop co-located listeners.
    const closeOnOutsideMouseDown = (e: MouseEvent) => {
      if (chapterMenuRef.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener("mousedown", closeOnOutsideMouseDown);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideMouseDown);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [chapterMenu]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/");
  }

  return (
    <div className="flex flex-col h-full bg-bg border-r border-border-subtle w-full">

      {/* Chapter right-click menu — positioned at the cursor. Same styling as the
          section kebab menu. Closes on outside interaction (see effect above). */}
      {chapterMenu && (
        <div
          ref={chapterMenuRef}
          className="fixed z-50 w-44 bg-panel border border-hover rounded-lg shadow-lg overflow-hidden"
          style={{ left: chapterMenu.x, top: chapterMenu.y }}
        >
          {/* Open side-by-side — desktop only (the mobile panel passes no handler).
              Disabled for a chapter that's already open in either editor: there'd
              be nowhere to put it, and the two editors can't show the same chapter. */}
          {onOpenSideBySide && (
            <>
              {(() => {
                const alreadyOpen =
                  chapterMenu.chapter.id === activeChapter?.id ||
                  chapterMenu.chapter.id === secondaryChapterId;
                return (
                  <button
                    disabled={alreadyOpen}
                    onClick={() => { onOpenSideBySide(chapterMenu.chapter.id); setChapterMenu(null); }}
                    className={`block w-full text-left px-4 py-2.5 text-xs transition-colors ${
                      alreadyOpen
                        ? "text-subtle/40 cursor-default"
                        : "text-text hover:bg-hover"
                    }`}
                  >
                    Open side-by-side
                  </button>
                );
              })()}
              <div className="h-px bg-hover" />
            </>
          )}
          <button
            onClick={() => { onDuplicateChapter(chapterMenu.chapter.id); setChapterMenu(null); }}
            className="block w-full text-left px-4 py-2.5 text-xs text-text hover:bg-hover transition-colors"
          >
            Duplicate
          </button>
          <div className="h-px bg-hover" />
          <button
            onClick={() => { setConfirmDeleteChapter(chapterMenu.chapter); setChapterMenu(null); }}
            className="block w-full text-left px-4 py-2.5 text-xs text-error hover:bg-hover transition-colors"
          >
            Delete
          </button>
        </div>
      )}

      {/* Confirmation modals */}
      {confirmDeleteSection && (
        <ConfirmModal
          message={
            <>
              Delete <strong className="text-text">{confirmDeleteSection.label}</strong>?{" "}
              All chapters in this section will be permanently deleted.
            </>
          }
          confirmLabel="Delete section"
          onConfirm={() => { onDeleteSection(confirmDeleteSection.id); setConfirmDeleteSection(null); }}
          onCancel={() => setConfirmDeleteSection(null)}
        />
      )}
      {confirmDeleteChapter && (
        <ConfirmModal
          message={
            <>
              Delete <strong className="text-text">{confirmDeleteChapter.title}</strong>?{" "}
              All scenes and library items will be permanently deleted.
              {deleteChapterShared && (
                <>
                  {" "}This chapter is shared — the copy your readers have keeps working unless you
                  stop sharing too.
                </>
              )}
            </>
          }
          extra={
            deleteChapterShared ? (
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={alsoStopSharing}
                  onChange={(e) => setAlsoStopSharing(e.target.checked)}
                  className="mt-0.5 accent-accent"
                />
                <span className="text-xs text-subtle leading-relaxed">
                  Also stop sharing this chapter — removes recipients’ access and deletes their
                  comments.
                </span>
              </label>
            ) : undefined
          }
          confirmLabel="Delete chapter"
          onConfirm={async () => {
            const { id } = confirmDeleteChapter;
            // Stop sharing BEFORE deleting the live chapter: the snapshot is keyed
            // by chapter_id, which the delete nulls out (§7), so it must go first.
            if (deleteChapterShared && alsoStopSharing) {
              try {
                await fetch(`/api/share?chapterId=${encodeURIComponent(id)}`, { method: "DELETE" });
              } catch {
                // Best-effort; still delete the chapter (its snapshot just lingers).
              }
            }
            onDeleteChapter(id);
            setConfirmDeleteChapter(null);
          }}
          onCancel={() => setConfirmDeleteChapter(null)}
        />
      )}

      {/* Panel Header — book-open icon, mirroring the Library Panel Header.
          Fixed h-16 so the Book Cover top lines up with the first Scene and
          the Image Gallery. The icon doubles as the collapse toggle (desktop
          only); the close affordance (mobile only) sits on the right. */}
      <div className="h-16 px-4 flex-shrink-0 flex items-center justify-between">
        {onToggleCollapse ? (
          <button
            onClick={onToggleCollapse}
            className="relative cursor-pointer text-subtle hover:text-text transition-colors"
            title={collapsed ? "Expand book panel" : "Collapse book panel"}
            aria-label={collapsed ? "Expand book panel" : "Collapse book panel"}
          >
            <Image src="/book-open.svg" alt="Book" width={20} height={20} />
            {/* Collapsed hides the account menu's Shared row — surface unread here. */}
            {collapsed && unreadTotal > 0 && <Badge dot className="absolute -top-1 -right-1" />}
          </button>
        ) : (
          <Image src="/book-open.svg" alt="Book" width={20} height={20} />
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="text-subtle hover:text-text transition-colors md:hidden"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Body — fixed to the expanded width and faded via `collapsed`, independently
          of the enclosing column's own (animating) width. This is what lets the
          collapse/expand run as a pure fade: the body's layout never changes size,
          it's just progressively revealed or hidden by the ancestor's overflow-hidden
          as that column width tweens, concurrently with this opacity. */}
      <div
        className="flex flex-col flex-1 min-h-0"
        style={
          expandedWidth != null
            ? {
                width: expandedWidth,
                opacity: collapsed ? 0 : 1,
                transition: "opacity 200ms ease-in-out",
                pointerEvents: collapsed ? "none" : undefined,
              }
            : undefined
        }
      >
      {/* Scrollable body — wrapped so the Tips overlay can anchor to its bottom
          edge (over the chapter list) without scrolling with the content. */}
      <div className="relative flex-1 min-h-0 flex flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto hc-scroll-hoverbar pl-4 pr-1.5 pt-4 pb-4">

        {/* ── Book Overview (cover + title) ── */}
        <BookOverview
          book={book}
          onCoverImage={onCoverImage}
          onRefreshCover={onRefreshCover}
          onOpenBookInfo={onOpenBookInfo}
          active={bookInfoActive}
        />

        {/* ── Sections ── */}
        {/* Wrapper (not the scroll body) owns containerProps so insertion-line
            drops commit here, without the cover drop zone above also bubbling
            into a section reorder. */}
        <div {...sectionReorder.containerProps()}>
        {sections.map((section, i) => (
          <Fragment key={section.id}>
            <DropLine active={sectionReorder.activeGap === i} />
            <SectionRow
              section={section}
              sectionIndex={i}
              sectionCount={sections.length}
              // While Book Info is the active view, no chapter is "active".
              activeChapter={bookInfoActive ? undefined : activeChapter}
              secondaryChapterId={secondaryChapterId}
              focusedPane={focusedPane}
              onChapterClick={onChapterClick}
              onSceneClick={onSceneClick}
              onAddChapter={onAddChapter}
              onDeleteChapterRequest={(ch) => setConfirmDeleteChapter(ch)}
              onReorderChapters={onReorderChapters}
              onMoveScene={onMoveScene}
              onMoveChapter={onMoveChapter}
              onDuplicateChapter={onDuplicateChapter}
              onOpenChapterMenu={openChapterMenu}
              onAddSection={onAddSection}
              onUpdateSectionLabel={onUpdateSectionLabel}
              onMoveSection={onReorderSections}
              onDeleteSectionRequest={(s) => setConfirmDeleteSection(s)}
              sectionDragProps={{ ...sectionReorder.dragHandleProps(i), ...sectionReorder.dropZoneProps(i) }}
              view={sectionViews[section.id] ?? "grid"}
              onSetView={onSetSectionView}
              scenesVisible={scenesVisible}
              dropChapterId={dropChapterId}
              dropGap={dropGap}
              setSceneDropTarget={setSceneDropTarget}
              clearSceneDropTarget={clearSceneDropTarget}
              chapterDrop={chapterDrop}
              setChapterDropTarget={setChapterDropTarget}
              clearChapterDropTarget={clearChapterDropTarget}
            />
          </Fragment>
        ))}
        <DropLine active={sectionReorder.activeGap === sections.length} />
        </div>
      </div>
        {/* Tips overlay — floats over the bottom of the chapter list. The wrapper
            is click-through; the card itself re-enables pointer events. */}
        {overlay && (
          <div className="absolute inset-x-0 bottom-0 z-10 px-3 pb-3 pointer-events-none">
            {overlay}
          </div>
        )}
      </div>

      {/* ── Logo + user menu ── */}
      <div ref={menuRef} className="px-5 py-4 flex-shrink-0 border-t border-border-subtle relative flex items-center justify-between">
        {menuOpen && (
          <div className="absolute bottom-full right-4 mb-2 w-40 bg-panel border border-hover rounded-lg shadow-lg overflow-hidden">
            <Link
              href="/books"
              onClick={() => setMenuOpen(false)}
              className="block w-full text-left px-4 py-2.5 text-xs text-text hover:bg-hover transition-colors"
            >
              Books
            </Link>
            <Link
              href="/backups"
              onClick={() => setMenuOpen(false)}
              className="block w-full text-left px-4 py-2.5 text-xs text-text hover:bg-hover transition-colors"
            >
              Backups
            </Link>
            <Link
              href="/export"
              onClick={() => setMenuOpen(false)}
              className="block w-full text-left px-4 py-2.5 text-xs text-text hover:bg-hover transition-colors"
            >
              Export
            </Link>
            <Link
              href="/settings"
              onClick={() => setMenuOpen(false)}
              className="block w-full text-left px-4 py-2.5 text-xs text-text hover:bg-hover transition-colors"
            >
              Settings
            </Link>
            <Link
              href="/account"
              onClick={() => setMenuOpen(false)}
              className="block w-full text-left px-4 py-2.5 text-xs text-text hover:bg-hover transition-colors"
            >
              Account
            </Link>

            {/* Shared with you — its own section below Account (§3.1). Label is
                "Shared"; the page title is "Shared with you". */}
            <div className="border-t border-hover" />
            <Link
              href="/shared"
              onClick={() => setMenuOpen(false)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-xs text-text hover:bg-hover transition-colors"
            >
              <span>Shared</span>
              {unreadTotal > 0 && <Badge count={unreadTotal} />}
            </Link>

            {/* Scene visibility — a user-level view preference, not a book edit.
                Off hides scene descriptions + the Add scene button everywhere;
                the underlying scene structure is left untouched. */}
            <div className="border-t border-hover" />
            <button
              onClick={onToggleScenes}
              className="flex w-full items-center justify-between px-4 py-2.5 text-xs text-text hover:bg-hover transition-colors"
              role="switch"
              aria-checked={scenesVisible}
            >
              <span>Show scenes</span>
              <span className={`relative w-7 h-4 rounded-full flex-shrink-0 transition-colors ${scenesVisible ? "bg-accent" : "bg-hover"}`}>
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${scenesVisible ? "left-3.5" : "left-0.5"}`} />
              </span>
            </button>

            {/* Link visibility — a user-level view preference, mirroring Show
                scenes. Off hides the Links section in the library panel. */}
            <button
              onClick={onToggleLinks}
              className="flex w-full items-center justify-between px-4 py-2.5 text-xs text-text hover:bg-hover transition-colors"
              role="switch"
              aria-checked={linksVisible}
            >
              <span>Show links</span>
              <span className={`relative w-7 h-4 rounded-full flex-shrink-0 transition-colors ${linksVisible ? "bg-accent" : "bg-hover"}`}>
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${linksVisible ? "left-3.5" : "left-0.5"}`} />
              </span>
            </button>

            {/* Light mode — a user-level display preference. Persisted to
                localStorage and applied app-wide via data-theme on <html>. */}
            <button
              onClick={toggleTheme}
              className="flex w-full items-center justify-between px-4 py-2.5 text-xs text-text hover:bg-hover transition-colors"
              role="switch"
              aria-checked={theme === "light"}
            >
              <span>Light mode</span>
              <span className={`relative w-7 h-4 rounded-full flex-shrink-0 transition-colors ${theme === "light" ? "bg-accent" : "bg-hover"}`}>
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${theme === "light" ? "left-3.5" : "left-0.5"}`} />
              </span>
            </button>
            <div className="border-t border-hover" />

            <button
              onClick={handleSignOut}
              className="block w-full text-left px-4 py-2.5 text-xs text-accent hover:bg-hover transition-colors"
            >
              Log out
            </button>
          </div>
        )}
        <Image
          src="/logo-wordmark.svg"
          alt="Hot Cocoa"
          width={93}
          height={17}
          priority
        />
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="relative text-subtle hover:text-text transition-colors leading-none flex items-center justify-center"
          title="Account"
          aria-label="Account menu"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="19" cy="12" r="1.5" />
          </svg>
          {/* Menu closed: a dot flags new shared activity without opening it. */}
          {!menuOpen && unreadTotal > 0 && <Badge dot className="absolute -top-1 -right-1" />}
        </button>
      </div>
      </div>
    </div>
  );
}
