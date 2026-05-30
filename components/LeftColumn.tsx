"use client";

import { useState, useRef } from "react";
import Image from "next/image";
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
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(book.title);
  const [coverDragging, setCoverDragging] = useState(false);
  const dragIndex = useRef<number | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

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
    <div className="flex flex-col h-full bg-[#18181a] border-r border-[#2a2a2c] w-full">
      {/* Wordmark */}
      <div className="px-5 pt-6 pb-2 flex-shrink-0">
        <Image
          src="/logo.svg"
          alt="Akuko"
          width={72}
          height={20}
          className="opacity-60"
          priority
        />
      </div>

      {/* Book cover + title */}
      <div className="px-4 pb-4 flex-shrink-0">
        {/* Cover — drag-and-droppable */}
        <div
          className={`w-full aspect-[2/3] rounded-md mb-3 relative overflow-hidden cursor-pointer group transition-colors ${
            coverDragging
              ? "ring-1 ring-[#c4a882] bg-[#c4a882]/5"
              : "bg-[#222224] hover:ring-1 hover:ring-[#2a2a2c]"
          }`}
          style={!book.coverImage ? { backgroundColor: book.coverColor } : {}}
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
            <span className="absolute inset-0 flex items-center justify-center text-[#9b9890] text-xs uppercase tracking-widest opacity-30 select-none group-hover:opacity-60 transition-opacity">
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
            className="w-full bg-transparent text-sm font-medium text-[#e8e6e3] border-b border-[#c4a882] pb-0.5 focus:outline-none"
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
            className="w-full text-left text-sm font-medium text-[#e8e6e3] hover:text-[#c4a882] transition-colors truncate"
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
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <p className="text-[10px] uppercase tracking-widest text-[#9b9890] mb-2 opacity-60">
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
                    ? "bg-[#2e2b27] text-[#c4a882] ring-1 ring-[#c4a882]/40"
                    : "bg-[#222224] text-[#9b9890] hover:bg-[#2a2a2c] hover:text-[#e8e6e3]"
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
            className="aspect-[3/4] rounded bg-[#222224] text-[#9b9890] hover:bg-[#2a2a2c] hover:text-[#c4a882] transition-colors flex items-center justify-center"
            title="Add chapter"
          >
            <Image src="/plus.svg" alt="Add chapter" width={14} height={14} className="opacity-50 hover:opacity-100 transition-opacity" />
          </button>
        </div>
      </div>

      {/* Avatar */}
      <div className="px-4 pb-5 flex-shrink-0 border-t border-[#2a2a2c] pt-3">
        <div className="w-8 h-8 rounded-full bg-[#2a2a2c] flex items-center justify-center">
          <svg
            className="w-4 h-4 text-[#9b9890]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
