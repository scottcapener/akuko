"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Book, Chapter, Scene, Section, LibraryImage } from "@/lib/types";
import { SaveStatus, useHotCocoaDb } from "@/lib/useHotCocoaDb";
import SceneBlock from "@/components/SceneBlock";
import { Tag, TagAddButton, TagManageButton } from "@/components/Tag";
import { BookTagsModal } from "@/components/BookTagsModal";
import { bookTagLabel } from "@/lib/bookTags";

type BookStats = ReturnType<typeof useHotCocoaDb>["bookStats"];

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

// "8h 20m" / "20m" / "45s" from a raw active-seconds total.
function formatWritingTime(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0m";
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

// "since Mar 2, 2026 · 130 days ago" from the book's creation date.
function sinceLabel(createdAt?: string): string {
  if (!createdAt) return "";
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
  return `since ${date} · ${days} ${days === 1 ? "day" : "days"} ago`;
}

// A stat card. `wide` spans the full width (Total words); the others sit two-up.
function StatCard({
  label,
  children,
  action,
}: {
  label: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded bg-panel p-8 flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <span className="text-body-m text-subtle">{label}</span>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

interface Props {
  book: Book;
  authorName: string;
  sections: Section[];
  infoChapter: Chapter | null;
  infoChapterLoaded: boolean;
  officialWordCount: number;
  bookStats: BookStats;
  saveStatus: SaveStatus;
  onTitleChange: (title: string) => void;
  onSceneChange: (chapterId: string, sceneId: string, patch: Partial<Scene>) => void;
  onToggleTag: (tagId: string) => void;
  onToggleExcludedSection: (sectionId: string) => void;
  onAddImage: (chapterId: string, img: LibraryImage) => void;
}

export default function BookInfoColumn({
  book,
  authorName,
  sections,
  infoChapter,
  infoChapterLoaded,
  officialWordCount,
  bookStats,
  saveStatus,
  onTitleChange,
  onSceneChange,
  onToggleTag,
  onToggleExcludedSection,
  onAddImage,
}: Props) {
  const [tagsOpen, setTagsOpen] = useState(false);
  const [excludeMenuOpen, setExcludeMenuOpen] = useState(false);
  const excludeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!excludeMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (!excludeMenuRef.current?.contains(e.target as Node)) setExcludeMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setExcludeMenuOpen(false); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [excludeMenuOpen]);

  // Clipboard paste → Book-Info library image (mirrors CenterColumn).
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      if (!infoChapter) return;
      const imageItem = Array.from(e.clipboardData.items).find((it) => it.type.startsWith("image/"));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      e.preventDefault();
      const reader = new FileReader();
      reader.onload = (ev) => {
        onAddImage(infoChapter.id, {
          id: makeId(),
          name: `pasted-${Date.now()}.png`,
          dataUrl: ev.target?.result as string,
        });
      };
      reader.readAsDataURL(file);
    },
    [infoChapter, onAddImage]
  );

  const synopsisScene = infoChapter?.scenes[0];
  const excluded = book.excludedSectionIds ?? [];
  const tags = book.tags ?? [];

  const sessionCount = bookStats?.sessionCount ?? 0;
  const avgPerSession = sessionCount > 0 ? Math.round(officialWordCount / sessionCount) : 0;

  return (
    <div
      className="flex flex-col h-full bg-bg w-full relative"
      data-paste-scope="center"
      onPaste={handlePaste}
    >
      {/* Save indicator — mirrors CenterColumn. */}
      {saveStatus !== "idle" && (
        <div
          className={`absolute top-4 right-4 text-[10px] uppercase tracking-widest transition-opacity z-10 ${
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

      <div className="flex-1 overflow-y-auto">
        <div className="w-full max-w-[700px] mx-auto px-6 pt-16 pb-32">
          {/* Title */}
          <input
            value={book.title}
            placeholder="Untitled Book"
            onChange={(e) => onTitleChange(e.target.value)}
            className="w-full bg-transparent text-heading-xl text-text placeholder:text-subtle/40 focus:outline-none"
          />

          {/* Author */}
          <p className="mt-2 text-body-m text-subtle">by {authorName}</p>

          {/* Tags */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {tags.length === 0 ? (
              <TagAddButton onClick={() => setTagsOpen(true)} />
            ) : (
              <>
                {tags.map((id) => (
                  <Tag key={id} label={bookTagLabel(id)} selected onClick={() => setTagsOpen(true)} />
                ))}
                <TagManageButton onClick={() => setTagsOpen(true)} />
              </>
            )}
          </div>

          {/* Synopsis */}
          <div className="mt-6">
            {synopsisScene ? (
              <SceneBlock
                scene={synopsisScene}
                chapterId={infoChapter!.id}
                index={0}
                onSceneChange={onSceneChange}
                fixedLabel="Synopsis"
                placeholder="Write a synopsis…"
              />
            ) : (
              <div className="px-4 py-3 animate-pulse" aria-hidden={!infoChapterLoaded}>
                <div className="h-2.5 w-24 bg-panel rounded mb-3" />
                <div className="h-3.5 w-full bg-panel rounded mb-2" />
                <div className="h-3.5 w-4/6 bg-panel rounded" />
              </div>
            )}
          </div>

          {/* Book Stats */}
          <div className="mt-8 flex flex-col gap-2.5">
            <StatCard
              label="Total words written"
              action={
                <div className="relative" ref={excludeMenuRef}>
                  <button
                    onClick={() => setExcludeMenuOpen((v) => !v)}
                    className="text-subtle hover:text-text transition-colors -m-1 p-1"
                    title="Choose which sections count"
                    aria-label="Choose which sections count toward the word total"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="5" cy="12" r="1.6" />
                      <circle cx="12" cy="12" r="1.6" />
                      <circle cx="19" cy="12" r="1.6" />
                    </svg>
                  </button>
                  {excludeMenuOpen && (
                    <div className="absolute right-0 top-full mt-1 z-20 w-56 bg-panel border border-hover rounded-lg shadow-lg overflow-hidden py-1">
                      <p className="px-3 py-2 text-label-m uppercase text-subtle">Count toward total</p>
                      {sections.map((s) => {
                        const on = !excluded.includes(s.id);
                        return (
                          <button
                            key={s.id}
                            onClick={() => onToggleExcludedSection(s.id)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-hover transition-colors"
                          >
                            <span
                              className={`flex items-center justify-center w-4 h-4 rounded border flex-shrink-0 ${
                                on ? "bg-accent border-accent" : "border-subtle"
                              }`}
                            >
                              {on && (
                                <svg className="w-3 h-3 text-text" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </span>
                            <span className="text-sm text-text truncate">{s.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              }
            >
              <div className="flex items-end justify-between gap-4">
                <span className="font-serif text-[33px] leading-none text-text tabular-nums">
                  {officialWordCount.toLocaleString()}
                </span>
                <span className="text-body-s text-subtle pb-1 whitespace-nowrap">
                  {sinceLabel(bookStats?.createdAt)}
                </span>
              </div>
            </StatCard>

            <div className="grid grid-cols-2 gap-2.5">
              <StatCard label="Average per session">
                <span className="font-serif text-[27px] leading-none text-text tabular-nums">
                  {avgPerSession.toLocaleString()}
                </span>
              </StatCard>
              <StatCard label="Time spent writing">
                <span className="font-serif text-[27px] leading-none text-text tabular-nums">
                  {formatWritingTime(bookStats?.totalActiveSeconds ?? 0)}
                </span>
              </StatCard>
            </div>
          </div>
        </div>
      </div>

      {tagsOpen && (
        <BookTagsModal
          selectedIds={tags}
          onToggle={onToggleTag}
          onClose={() => setTagsOpen(false)}
        />
      )}
    </div>
  );
}
