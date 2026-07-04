"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Book, Section, Chapter } from "@/lib/types";
import { Button, Modal } from "@/components/ui";

interface Props {
  book: Book;
  sections: Section[];
  activeChapter: Chapter;
  onBookTitleChange: (t: string) => void;
  onChapterClick: (id: string) => void;
  onCoverImage: (dataUrl: string | undefined) => void;
  onAddChapter: (sectionId: string) => void;
  onDeleteChapter: (chapterId: string) => void;
  onReorderChapters: (sectionId: string, from: number, to: number) => void;
  onAddSection: (afterSectionId: string) => void;
  onUpdateSectionLabel: (sectionId: string, label: string) => void;
  onReorderSections: (from: number, to: number) => void;
  onDeleteSection: (sectionId: string) => void;
  scenesVisible: boolean;
  onToggleScenes: () => void;
  sectionViews: Record<string, "grid" | "list">;
  onSetSectionView: (sectionId: string, view: "grid" | "list") => void;
  onClose?: () => void;
}

// ── Confirmation modal ────────────────────────────────────────────────────────

function ConfirmModal({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  message: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal onClose={onCancel} maxWidth="max-w-sm" backdrop="dark">
      <div className="p-5 flex flex-col gap-4">
        <p className="text-sm text-text leading-relaxed">{message}</p>
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

// ── Section row ───────────────────────────────────────────────────────────────

function SectionRow({
  section,
  sectionIndex,
  sectionCount,
  activeChapter,
  onChapterClick,
  onAddChapter,
  onDeleteChapterRequest,
  onReorderChapters,
  onAddSection,
  onUpdateSectionLabel,
  onReorderSectionsRequest,
  onDeleteSectionRequest,
  dragSectionIndex,
  view,
  onSetView,
  scenesVisible,
}: {
  section: Section;
  sectionIndex: number;
  sectionCount: number;
  activeChapter: Chapter | undefined;
  onChapterClick: (id: string) => void;
  onAddChapter: (sectionId: string) => void;
  onDeleteChapterRequest: (chapter: Chapter) => void;
  onReorderChapters: (sectionId: string, from: number, to: number) => void;
  onAddSection: (afterSectionId: string) => void;
  onUpdateSectionLabel: (sectionId: string, label: string) => void;
  onReorderSectionsRequest: (from: number, to: number) => void;
  onDeleteSectionRequest: (section: Section) => void;
  dragSectionIndex: React.MutableRefObject<number | null>;
  view: "grid" | "list";
  onSetView: (sectionId: string, view: "grid" | "list") => void;
  scenesVisible: boolean;
}) {
  const activeChapterId = activeChapter?.id ?? "";
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(section.label);
  const [menuOpen, setMenuOpen] = useState(false);
  const dragChapterIndex = useRef<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  return (
    <div
      draggable
      onDragStart={(e) => {
        dragSectionIndex.current = sectionIndex;
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (dragSectionIndex.current !== null && dragSectionIndex.current !== sectionIndex) {
          onReorderSectionsRequest(dragSectionIndex.current, sectionIndex);
        }
        dragSectionIndex.current = null;
      }}
      className="mb-4"
    >
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
        {section.chapters.map((ch, i) => (
          <div key={ch.id} className="relative group/chapter">
            <button
              draggable
              onDragStart={(e) => {
                dragChapterIndex.current = i;
                e.dataTransfer.effectAllowed = "move";
                e.stopPropagation();
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (dragChapterIndex.current !== null && dragChapterIndex.current !== i) {
                  onReorderChapters(section.id, dragChapterIndex.current, i);
                }
                dragChapterIndex.current = null;
              }}
              onClick={() => onChapterClick(ch.id)}
              className={`
                w-full aspect-[3/4] rounded text-[9px] font-medium text-center
                flex items-center justify-center px-1
                transition-colors truncate leading-tight
                ${ch.id === activeChapterId
                  ? "bg-elevated text-muted border-[1.5px] border-subtle"
                  : "bg-panel text-subtle hover:bg-hover hover:text-text"
                }
              `}
              title={ch.title}
            >
              <span className="truncate w-full text-center leading-tight">{ch.title}</span>
            </button>

            {/* Circle-× delete on hover */}
            <button
              onClick={(e) => { e.stopPropagation(); onDeleteChapterRequest(ch); }}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-bg border border-hover items-center justify-center hidden group-hover/chapter:flex text-subtle hover:text-error hover:border-error/40 transition-colors z-10"
              title="Delete chapter"
            >
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}

        {/* Add chapter */}
        <button
          onClick={() => onAddChapter(section.id)}
          className="aspect-[3/4] rounded bg-panel text-subtle hover:bg-hover hover:text-accent transition-colors flex items-center justify-center"
          title="Add chapter"
        >
          <Image src="/plus.svg" alt="Add chapter" width={14} height={14} className="opacity-50 hover:opacity-100 transition-opacity" />
        </button>
      </div>
      ) : (
      /* Chapter list — active chapter expands to show its scene descriptions */
      <div className="flex flex-col gap-0.5">
        {section.chapters.map((ch, i) => {
          const isActive = ch.id === activeChapterId;
          return (
          <div key={ch.id}>
            {/* Chapter row — styled like a Note list item (icon + text + hover-reveal delete) */}
            <div
              draggable
              onDragStart={(e) => {
                dragChapterIndex.current = i;
                e.dataTransfer.effectAllowed = "move";
                e.stopPropagation();
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (dragChapterIndex.current !== null && dragChapterIndex.current !== i) {
                  onReorderChapters(section.id, dragChapterIndex.current, i);
                }
                dragChapterIndex.current = null;
              }}
              onClick={() => onChapterClick(ch.id)}
              title={ch.title}
              className={`flex items-center gap-2 group/chapter px-2 py-1.5 rounded transition-colors cursor-pointer ${
                isActive ? "bg-elevated" : "hover:bg-panel"
              }`}
            >
              {/* Chapter marker — a small rectangle echoing the grid-view cell:
                  active gets a border + fill, inactive is a solid fill. */}
              <span className="w-3.5 flex-shrink-0 flex items-center justify-center" aria-hidden>
                <span className={`w-2.5 h-3.5 rounded-[2px] ${
                  isActive ? "bg-[#2A2A2D] border-[1.5px] border-subtle" : "bg-subtle/50"
                }`} />
              </span>
              <span className={`text-xs flex-1 truncate ${
                ch.title ? "text-text" : "text-subtle/35 italic"
              }`}>
                {ch.title || "Untitled chapter"}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onDeleteChapterRequest(ch); }}
                className="hidden group-hover/chapter:flex text-subtle hover:text-error transition-colors flex-shrink-0"
                title="Delete chapter"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Scene descriptions for the active chapter — nested under the chapter,
                text-only (no marker), tightly spaced. */}
            {isActive && scenesVisible && (
              <div className="flex flex-col">
                {(activeChapter?.scenes ?? []).length === 0 ? (
                  <p className="text-xs text-subtle/40 italic pl-8 py-0.5">No scenes yet</p>
                ) : (
                  (activeChapter?.scenes ?? []).map((scene) => (
                    <div key={scene.id} className="px-2 py-0.5 pl-8">
                      <span className={`block text-xs truncate ${
                        scene.label ? "text-subtle" : "text-subtle/35 italic"
                      }`}>
                        {scene.label || "Untitled scene"}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          );
        })}

        {/* Add chapter */}
        <button
          onClick={() => onAddChapter(section.id)}
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
  onBookTitleChange,
  onChapterClick,
  onCoverImage,
  onAddChapter,
  onDeleteChapter,
  onReorderChapters,
  onAddSection,
  onUpdateSectionLabel,
  onReorderSections,
  onDeleteSection,
  scenesVisible,
  onToggleScenes,
  sectionViews,
  onSetSectionView,
  onClose,
}: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(book.title);
  const [coverDragging, setCoverDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDeleteSection, setConfirmDeleteSection] = useState<Section | null>(null);
  const [confirmDeleteChapter, setConfirmDeleteChapter] = useState<Chapter | null>(null);

  const coverInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dragSectionIndex = useRef<number | null>(null);

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

  function commitTitle() {
    setEditingTitle(false);
    onBookTitleChange(titleDraft.trim() || "Untitled Book");
  }

  function handleCoverFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => onCoverImage(e.target?.result as string);
    reader.readAsDataURL(file);
  }

  function handleCoverDrop(e: React.DragEvent) {
    e.preventDefault();
    setCoverDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleCoverFile(file);
  }

  return (
    <div className="flex flex-col h-full bg-bg border-r border-border-subtle w-full">

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
            </>
          }
          confirmLabel="Delete chapter"
          onConfirm={() => { onDeleteChapter(confirmDeleteChapter.id); setConfirmDeleteChapter(null); }}
          onCancel={() => setConfirmDeleteChapter(null)}
        />
      )}

      {/* Panel Header — book-open icon, mirroring the Library Panel Header.
          Fixed h-16 so the Book Cover top lines up with the first Scene and
          the Image Gallery. The close affordance (mobile only) sits on the right. */}
      <div className="h-16 px-4 flex-shrink-0 flex items-center justify-between">
        <Image src="/book-open.svg" alt="Book" width={20} height={20} />
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

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-4">

        {/* ── Cover + Title ── */}
        <div className="mb-3">
          <div
            className={`w-full max-w-[140px] md:max-w-none rounded-md relative overflow-hidden cursor-pointer group transition-colors ${
              book.coverImage
                ? "aspect-[2/3]"
                : "flex flex-col items-center justify-center py-5 gap-2"
            } ${
              coverDragging
                ? "ring-1 ring-accent bg-accent/5"
                : book.coverImage
                  ? "bg-panel hover:ring-1 hover:ring-hover"
                  : "border border-dashed border-hover hover:border-muted/40"
            }`}
            onDragOver={(e) => { e.preventDefault(); setCoverDragging(true); }}
            onDragLeave={() => setCoverDragging(false)}
            onDrop={handleCoverDrop}
            onClick={() => coverInputRef.current?.click()}
          >
            {book.coverImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={book.coverImage} alt="Book cover" className="w-full h-full object-cover" />
            ) : (
              <>
                <svg
                  className="w-4 h-4 text-subtle opacity-50 group-hover:opacity-80 transition-opacity"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                </svg>
                <span className="text-[9px] text-subtle opacity-50 group-hover:opacity-80 uppercase tracking-widest transition-opacity select-none">
                  Add cover
                </span>
              </>
            )}
            {book.coverImage && (
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-[10px] uppercase tracking-widest">
                  Replace
                </span>
              </div>
            )}
            {book.coverImage && (
              <button
                onClick={(e) => { e.stopPropagation(); onCoverImage(undefined); }}
                className="absolute top-1.5 right-1.5 w-5 h-5 bg-black/70 rounded-full items-center justify-center hidden group-hover:flex"
              >
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCoverFile(f); }}
          />

          {/* Book title */}
          {editingTitle ? (
            <input
              autoFocus
              className="w-full bg-transparent text-heading-m text-text border-b border-accent pb-0.5 mt-2 focus:outline-none"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTitle();
                if (e.key === "Escape") { setTitleDraft(book.title); setEditingTitle(false); }
              }}
            />
          ) : (
            <button
              // py-1 -my-1: expands truncate's overflow-hidden clip box so
              // descenders/caps aren't cropped by the line-height:1 heading token,
              // while the negative margin keeps layout position unchanged.
              className="w-full text-left text-heading-m text-text hover:text-accent transition-colors truncate mt-2 py-1 -my-1"
              onClick={() => { setTitleDraft(book.title); setEditingTitle(true); }}
            >
              {book.title}
            </button>
          )}
        </div>

        {/* ── Sections ── */}
        {sections.map((section, i) => (
          <SectionRow
            key={section.id}
            section={section}
            sectionIndex={i}
            sectionCount={sections.length}
            activeChapter={activeChapter}
            onChapterClick={onChapterClick}
            onAddChapter={onAddChapter}
            onDeleteChapterRequest={(ch) => setConfirmDeleteChapter(ch)}
            onReorderChapters={onReorderChapters}
            onAddSection={onAddSection}
            onUpdateSectionLabel={onUpdateSectionLabel}
            onReorderSectionsRequest={onReorderSections}
            onDeleteSectionRequest={(s) => setConfirmDeleteSection(s)}
            dragSectionIndex={dragSectionIndex}
            view={sectionViews[section.id] ?? "grid"}
            onSetView={onSetSectionView}
            scenesVisible={scenesVisible}
          />
        ))}
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
              href="/account"
              onClick={() => setMenuOpen(false)}
              className="block w-full text-left px-4 py-2.5 text-xs text-text hover:bg-hover transition-colors"
            >
              Account
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
          className="text-subtle hover:text-text transition-colors leading-none flex items-center justify-center"
          title="Account"
          aria-label="Account menu"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="19" cy="12" r="1.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
