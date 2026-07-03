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
  activeChapterId,
  onChapterClick,
  onAddChapter,
  onDeleteChapterRequest,
  onReorderChapters,
  onAddSection,
  onUpdateSectionLabel,
  onReorderSectionsRequest,
  onDeleteSectionRequest,
  dragSectionIndex,
}: {
  section: Section;
  sectionIndex: number;
  sectionCount: number;
  activeChapterId: string;
  onChapterClick: (id: string) => void;
  onAddChapter: (sectionId: string) => void;
  onDeleteChapterRequest: (chapter: Chapter) => void;
  onReorderChapters: (sectionId: string, from: number, to: number) => void;
  onAddSection: (afterSectionId: string) => void;
  onUpdateSectionLabel: (sectionId: string, label: string) => void;
  onReorderSectionsRequest: (from: number, to: number) => void;
  onDeleteSectionRequest: (section: Section) => void;
  dragSectionIndex: React.MutableRefObject<number | null>;
}) {
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(section.label);
  const dragChapterIndex = useRef<number | null>(null);

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
          className="opacity-0 group-hover/section:opacity-40 hover:!opacity-100 transition-opacity flex-shrink-0"
          title="Add section below"
        >
          <Image src="/plus.svg" alt="Add section" width={12} height={12} />
        </button>

        {/* Delete section (hidden when only one) */}
        {sectionCount > 1 && (
          <button
            onClick={() => onDeleteSectionRequest(section)}
            className="opacity-0 group-hover/section:opacity-30 hover:!opacity-70 transition-opacity flex-shrink-0 text-text"
            title="Delete section"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Chapter grid */}
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
  onClose,
}: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(book.title);
  const [coverDragging, setCoverDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scenesExpanded, setScenesExpanded] = useState(true);
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

  const sceneLabels = activeChapter?.scenes ?? [];

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
              className="w-full text-left text-heading-m text-text hover:text-accent transition-colors truncate mt-2"
              onClick={() => { setTitleDraft(book.title); setEditingTitle(true); }}
            >
              {book.title}
            </button>
          )}
        </div>

        {/* ── Scenes ── */}
        <div className="mb-4">
          <button
            onClick={() => setScenesExpanded((v) => !v)}
            className="w-full flex items-center justify-between mb-1.5 group"
          >
            <span className="text-[11px] font-medium tracking-wide uppercase text-subtle group-hover:text-text transition-colors">
              Scenes
            </span>
            <svg
              className={`w-3 h-3 text-subtle group-hover:text-text transition-all ${scenesExpanded ? "rotate-0" : "-rotate-90"}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>

          {scenesExpanded && (
            <div className="flex flex-col gap-0.5">
              {sceneLabels.length === 0 ? (
                <p className="text-[10px] text-subtle/40 italic pl-1">No scenes yet</p>
              ) : (
                sceneLabels.map((scene) => (
                  <div key={scene.id} className="px-1 py-0.5">
                    <p className={`text-[11px] truncate leading-tight ${
                      scene.label ? "text-muted" : "text-subtle/40 italic"
                    }`}>
                      {scene.label || "—"}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* ── Sections ── */}
        {sections.map((section, i) => (
          <SectionRow
            key={section.id}
            section={section}
            sectionIndex={i}
            sectionCount={sections.length}
            activeChapterId={activeChapter?.id ?? ""}
            onChapterClick={onChapterClick}
            onAddChapter={onAddChapter}
            onDeleteChapterRequest={(ch) => setConfirmDeleteChapter(ch)}
            onReorderChapters={onReorderChapters}
            onAddSection={onAddSection}
            onUpdateSectionLabel={onUpdateSectionLabel}
            onReorderSectionsRequest={onReorderSections}
            onDeleteSectionRequest={(s) => setConfirmDeleteSection(s)}
            dragSectionIndex={dragSectionIndex}
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
              href="/account"
              onClick={() => setMenuOpen(false)}
              className="block w-full text-left px-4 py-2.5 text-xs text-text hover:bg-hover transition-colors"
            >
              Account
            </Link>
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
