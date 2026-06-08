"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Book, Chapter } from "@/lib/types";

interface Props {
  book: Book;
  activeChapter: Chapter;
  onBookTitleChange: (t: string) => void;
  onChapterClick: (id: string) => void;
  onAddChapter: () => void;
  onReorderChapters: (from: number, to: number) => void;
  onCoverImage: (dataUrl: string | undefined) => void;
}

export default function LeftColumn({
  book,
  activeChapter,
  onBookTitleChange,
  onChapterClick,
  onAddChapter,
  onReorderChapters,
  onCoverImage,
}: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(book.title);
  const [coverDragging, setCoverDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const dragIndex = useRef<number | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  function handleChapterDragStart(e: React.DragEvent, index: number) {
    dragIndex.current = index;
    e.dataTransfer.effectAllowed = "move";
  }

  function handleChapterDrop(e: React.DragEvent, toIndex: number) {
    e.preventDefault();
    if (dragIndex.current !== null && dragIndex.current !== toIndex) {
      onReorderChapters(dragIndex.current, toIndex);
    }
    dragIndex.current = null;
  }

  function handleCoverFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      onCoverImage(dataUrl);
    };
    reader.readAsDataURL(file);
  }

  function handleCoverDrop(e: React.DragEvent) {
    e.preventDefault();
    setCoverDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleCoverFile(file);
  }

  return (
    <div className="flex flex-col h-full bg-[#100F0F] border-r border-[#1C1B1B] w-full">
      {/* Wordmark */}
      <div className="px-5 pt-6 pb-5 flex-shrink-0">
        <Image
          src="/logo-S.svg"
          alt="Hakuko"
          width={85}
          height={22}
          style={{ filter: 'brightness(0) invert(1)' }}
          priority
        />
      </div>

      {/* Scrollable: cover + title + chapters */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {/* Cover — drag-and-droppable */}
        <div className="mb-3">
        <div
          className={`w-full max-w-[140px] md:max-w-none aspect-[2/3] rounded-md relative overflow-hidden cursor-pointer group transition-colors ${
            coverDragging
              ? "ring-1 ring-[#755C4B] bg-[#755C4B]/5"
              : "bg-[#1C1B1B] hover:ring-1 hover:ring-[#252220]"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setCoverDragging(true);
          }}
          onDragLeave={() => setCoverDragging(false)}
          onDrop={handleCoverDrop}
          onClick={() => coverInputRef.current?.click()}
        >
          {book.coverImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={book.coverImage}
              alt="Book cover"
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-[#413E3C] text-xs uppercase tracking-widest opacity-30 select-none group-hover:opacity-60 transition-opacity">
              Cover
            </span>
          )}
          {/* Overlay hint on hover when there's already an image */}
          {book.coverImage && (
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
              <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-[10px] uppercase tracking-widest">
                Replace
              </span>
            </div>
          )}
          {/* Remove cover button */}
          {book.coverImage && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCoverImage(undefined);
              }}
              className="absolute top-1.5 right-1.5 w-5 h-5 bg-black/70 rounded-full items-center justify-center hidden group-hover:flex transition-opacity"
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
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleCoverFile(file);
          }}
        />

        {/* Editable book title */}
        {editingTitle ? (
          <input
            autoFocus
            className="w-full bg-transparent text-sm font-medium text-[#E1E1DF] border-b border-[#755C4B] pb-0.5 focus:outline-none"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTitle();
              if (e.key === "Escape") {
                setTitleDraft(book.title);
                setEditingTitle(false);
              }
            }}
          />
        ) : (
          <button
            className="w-full text-left text-sm font-medium text-[#E1E1DF] hover:text-[#755C4B] transition-colors truncate"
            onClick={() => {
              setTitleDraft(book.title);
              setEditingTitle(true);
            }}
          >
            {book.title}
          </button>
        )}
        </div>

        {/* Chapter grid */}
        <p className="text-[11px] font-medium tracking-wide uppercase text-[#413E3C] mb-2 mt-4">
          Chapters
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {book.chapters.map((ch, i) => (
            <button
              key={ch.id}
              draggable
              onDragStart={(e) => handleChapterDragStart(e, i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleChapterDrop(e, i)}
              onClick={() => onChapterClick(ch.id)}
              className={`
                aspect-[3/4] rounded text-[9px] font-medium text-center
                flex items-center justify-center px-1
                transition-colors truncate leading-tight
                ${
                  ch.id === activeChapter.id
                    ? "bg-[#1C1B1B] text-[#755C4B] ring-1 ring-[#755C4B]/40"
                    : "bg-[#1C1B1B] text-[#413E3C] hover:bg-[#252220] hover:text-[#E1E1DF]"
                }
              `}
              title={ch.title}
            >
              <span className="truncate w-full text-center leading-tight">{ch.title}</span>
            </button>
          ))}

          {/* Add chapter slot — plus always visible */}
          <button
            onClick={onAddChapter}
            className="aspect-[3/4] rounded bg-[#1C1B1B] text-[#413E3C] hover:bg-[#252220] hover:text-[#755C4B] transition-colors flex items-center justify-center"
            title="Add chapter"
          >
            <Image src="/plus.svg" alt="Add chapter" width={14} height={14} className="opacity-50 hover:opacity-100 transition-opacity" />
          </button>
        </div>
      </div>

      {/* User menu */}
      <div ref={menuRef} className="px-4 pb-5 flex-shrink-0 border-t border-[#1C1B1B] pt-3 relative">
        {menuOpen && (
          <div className="absolute bottom-full left-4 mb-2 w-40 bg-[#1C1B1B] border border-[#252220] rounded-lg shadow-lg overflow-hidden">
            <Link
              href="/account"
              onClick={() => setMenuOpen(false)}
              className="block w-full text-left px-4 py-2.5 text-xs text-[#E1E1DF] hover:bg-[#252220] transition-colors"
            >
              Account
            </Link>
            <button
              onClick={handleSignOut}
              className="block w-full text-left px-4 py-2.5 text-xs text-[#755C4B] hover:bg-[#252220] transition-colors"
            >
              Log out
            </button>
          </div>
        )}
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="text-[#413E3C] hover:text-[#E1E1DF] transition-colors text-base font-bold tracking-widest leading-none px-1"
          title="Account"
        >
          •••
        </button>
      </div>
    </div>
  );
}
