"use client";

import { useState, useRef, useCallback } from "react";
import { Chapter, LibraryImage, LibraryFile, LibraryMusicLink } from "@/lib/types";

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

interface Props {
  chapter: Chapter;
  onAddImage: (chapterId: string, img: LibraryImage) => void;
  onRemoveImage: (chapterId: string, imgId: string) => void;
  onAddFile: (chapterId: string, file: LibraryFile) => void;
  onRemoveFile: (chapterId: string, fileId: string) => void;
  onAddMusicLink: (chapterId: string, link: LibraryMusicLink) => void;
  onRemoveMusicLink: (chapterId: string, linkId: string) => void;
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center cursor-pointer"
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Lightbox"
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-md"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

export default function RightColumn({
  chapter,
  onAddImage,
  onRemoveImage,
  onAddFile,
  onRemoveFile,
  onAddMusicLink,
  onRemoveMusicLink,
}: Props) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [draggingOver, setDraggingOver] = useState(false);
  const [musicUrl, setMusicUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  const processImageFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      Array.from(files).forEach((file) => {
        if (!file.type.startsWith("image/")) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;
          onAddImage(chapter.id, { id: makeId(), name: file.name, dataUrl });
        };
        reader.readAsDataURL(file);
      });
    },
    [chapter.id, onAddImage]
  );

  const processTextFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      Array.from(files).forEach((file) => {
        if (!file.name.endsWith(".txt") && !file.name.endsWith(".md")) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target?.result as string;
          onAddFile(chapter.id, { id: makeId(), name: file.name, content });
        };
        reader.readAsText(file);
      });
    },
    [chapter.id, onAddFile]
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDraggingOver(false);
    processImageFiles(e.dataTransfer.files);
  }

  function handleMusicAdd() {
    const url = musicUrl.trim();
    if (!url) return;
    let title = url;
    try {
      const u = new URL(url);
      title = u.hostname.replace("www.", "");
    } catch {}
    onAddMusicLink(chapter.id, {
      id: makeId(),
      url,
      title,
    });
    setMusicUrl("");
  }

  return (
    <div className="flex flex-col h-full bg-[#18181a] border-l border-[#2a2a2c] w-full overflow-y-auto">
      {lightboxSrc && (
        <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}

      <div className="px-4 pt-5 pb-2 flex-shrink-0">
        <p className="text-[10px] uppercase tracking-widest text-[#9b9890] opacity-60">
          Library
        </p>
      </div>

      {/* Image drop zone */}
      <div
        className={`mx-4 mb-3 rounded-lg border border-dashed transition-colors ${
          draggingOver
            ? "border-[#c4a882] bg-[#c4a882]/5"
            : "border-[#2a2a2c] hover:border-[#9b9890]/40"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDraggingOver(true);
        }}
        onDragLeave={() => setDraggingOver(false)}
        onDrop={handleDrop}
      >
        {chapter.library.images.length === 0 ? (
          <div
            className="py-5 flex flex-col items-center gap-2 cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <svg
              className="w-5 h-5 text-[#9b9890]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
              />
            </svg>
            <span className="text-[10px] text-[#9b9890] uppercase tracking-widest">
              Drop images or click
            </span>
          </div>
        ) : (
          <div className="p-2 grid grid-cols-3 gap-1.5">
            {chapter.library.images.map((img) => (
              <div key={img.id} className="relative group aspect-square">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  className="w-full h-full object-cover rounded cursor-pointer"
                  onClick={() => setLightboxSrc(img.dataUrl)}
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveImage(chapter.id, img.id);
                  }}
                  className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/70 rounded-full items-center justify-center hidden group-hover:flex"
                >
                  <svg
                    className="w-2.5 h-2.5 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
            {/* Add more images */}
            <button
              className="aspect-square rounded bg-[#222224] flex items-center justify-center text-[#9b9890] hover:text-[#c4a882] transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => processImageFiles(e.target.files)}
        />
      </div>

      {/* Text files */}
      <div className="px-4 mb-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase tracking-widest text-[#9b9890] opacity-60">
            Text files
          </p>
          <button
            className="text-[#9b9890] hover:text-[#c4a882] transition-colors"
            onClick={() => textInputRef.current?.click()}
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
        <input
          ref={textInputRef}
          type="file"
          accept=".txt,.md"
          multiple
          className="hidden"
          onChange={(e) => processTextFiles(e.target.files)}
        />
        {chapter.library.files.length === 0 ? (
          <p className="text-[11px] text-[#9b9890]/40 italic">No text files yet</p>
        ) : (
          <div className="flex flex-col gap-1">
            {chapter.library.files.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-2 group px-2 py-1.5 rounded hover:bg-[#1f1f21] transition-colors"
              >
                <svg
                  className="w-4 h-4 text-[#9b9890] flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                  />
                </svg>
                <span className="text-xs text-[#e8e6e3] truncate flex-1">{f.name}</span>
                <button
                  onClick={() => onRemoveFile(chapter.id, f.id)}
                  className="hidden group-hover:block text-[#9b9890] hover:text-red-400 transition-colors"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Music links */}
      <div className="px-4 pb-6">
        <p className="text-[10px] uppercase tracking-widest text-[#9b9890] opacity-60 mb-2">
          Music
        </p>
        <div className="flex gap-2 mb-3">
          <input
            type="url"
            placeholder="Paste a link…"
            value={musicUrl}
            onChange={(e) => setMusicUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleMusicAdd()}
            className="flex-1 bg-[#222224] text-[#e8e6e3] text-xs px-3 py-1.5 rounded border border-[#2a2a2c] placeholder:text-[#9b9890]/40 focus:outline-none focus:border-[#c4a882]/50"
          />
          <button
            onClick={handleMusicAdd}
            className="px-2.5 py-1.5 rounded bg-[#2a2a2c] text-[#9b9890] hover:text-[#c4a882] text-xs transition-colors"
          >
            Add
          </button>
        </div>
        {chapter.library.musicLinks.length === 0 ? (
          <p className="text-[11px] text-[#9b9890]/40 italic">No music links yet</p>
        ) : (
          <div className="flex flex-col gap-2">
            {chapter.library.musicLinks.map((link) => (
              <div
                key={link.id}
                className="flex items-center gap-2.5 group bg-[#1f1f21] rounded-lg px-3 py-2 hover:bg-[#222224] transition-colors"
              >
                {/* Placeholder art */}
                <div className="w-9 h-9 rounded bg-[#2a2a2c] flex-shrink-0 flex items-center justify-center">
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
                      d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z"
                    />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[#e8e6e3] truncate">{link.title}</p>
                  <p className="text-[10px] text-[#9b9890] truncate">{link.url}</p>
                </div>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 text-[#9b9890] hover:text-[#c4a882] transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z"
                    />
                  </svg>
                </a>
                <button
                  onClick={() => onRemoveMusicLink(chapter.id, link.id)}
                  className="hidden group-hover:block text-[#9b9890] hover:text-red-400 transition-colors flex-shrink-0"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
