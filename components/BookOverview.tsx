"use client";

import { useRef, useState } from "react";
import { Book } from "@/lib/types";

// The Book Panel's Book Overview (Figma 172:5248): the cover and title merged
// into one unit. Clicking the title opens the Book Info editor; the cover keeps
// its own upload / drag-to-replace behavior. `active` reflects Book Info being
// open, so the title reads as the current selection (mirrors an active chapter).
export default function BookOverview({
  book,
  onCoverImage,
  onRefreshCover,
  onOpenBookInfo,
  active = false,
}: {
  book: Book;
  onCoverImage: (file: File | undefined, previewDataUrl?: string) => void;
  onRefreshCover?: () => void;
  onOpenBookInfo: () => void;
  active?: boolean;
}) {
  const [coverDragging, setCoverDragging] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  // Guards the cover re-sign so an image that's genuinely broken (not just an
  // expired signed URL) can't loop onError → refresh → onError.
  const coverRetried = useRef(false);

  function handleCoverFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => onCoverImage(file, e.target?.result as string);
    reader.readAsDataURL(file);
  }

  function handleCoverDrop(e: React.DragEvent) {
    e.preventDefault();
    setCoverDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleCoverFile(file);
  }

  return (
    <div
      // Border is always present (transparent when inactive) and padding tweens,
      // so the active card's slightly larger footprint eases in/out rather than
      // snapping. transition-all covers padding + border-color + background.
      className={`mb-3 rounded-lg border transition-all duration-200 ease-in-out ${
        active ? "border-subtle bg-elevated p-2" : "border-transparent p-0"
      }`}
    >
      {/* Cover — click to upload / replace; drag an image on to set. */}
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
          <img
            src={book.coverImage}
            alt="Book cover"
            className="w-full h-full object-cover"
            onLoad={() => { coverRetried.current = false; }}
            onError={() => {
              // Likely an expired signed URL — re-mint it once.
              if (coverRetried.current || !onRefreshCover) return;
              coverRetried.current = true;
              onRefreshCover();
            }}
          />
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

      {/* Title — opens Book Info (no longer inline-edited here; the title is
          edited inside the Book Info editor). */}
      <button
        // py-1 -my-1: expands truncate's overflow-hidden clip box so
        // descenders/caps aren't cropped by the line-height:1 heading token,
        // while the negative margin keeps layout position unchanged.
        onClick={onOpenBookInfo}
        title={book.title || "Untitled Book"}
        className="w-full text-left text-heading-m text-text hover:text-white transition-colors truncate mt-2 py-1 -my-1"
      >
        {book.title || "Untitled Book"}
      </button>
    </div>
  );
}
