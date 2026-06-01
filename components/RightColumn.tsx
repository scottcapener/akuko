"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Chapter, LibraryImage, LibraryNote } from "@/lib/types";

// Renders children into document.body so fixed overlays escape transformed parents
function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

// ── Image lightbox ────────────────────────────────────────────────────────────

function ImageLightbox({
  images,
  index,
  onClose,
  onNavigate,
}: {
  images: { dataUrl: string }[];
  index: number;
  onClose: () => void;
  onNavigate: (next: number) => void;
}) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") onNavigate((index + 1) % images.length);
      else if (e.key === "ArrowLeft") onNavigate((index - 1 + images.length) % images.length);
      else if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [index, images.length, onClose, onNavigate]);

  return (
    <div
      className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center cursor-pointer"
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={images[index].dataUrl}
        alt="Lightbox"
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-md"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ── Note lightbox ─────────────────────────────────────────────────────────────

function NoteLightbox({
  notes,
  index,
  onClose,
  onNavigate,
  onUpdate,
}: {
  notes: LibraryNote[];
  index: number;
  onClose: () => void;
  onNavigate: (i: number) => void;
  onUpdate: (noteId: string, patch: { title?: string; body?: string }) => void;
}) {
  const note = notes[index];
  const bodyRef = useRef<HTMLDivElement>(null);

  // Sync body HTML whenever the active note changes
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.innerHTML = note.body;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  // Escape to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }

  function handleBodyKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Allow Cmd/Ctrl+I for italic; block all other formatting shortcuts
    if ((e.metaKey || e.ctrlKey) && !["i", "z", "a", "c", "x", "v"].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
  }

  const multi = notes.length > 1;

  return (
    <div
      className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-[#1c1c1e] rounded-2xl w-full max-w-lg flex flex-col shadow-2xl overflow-hidden"
        style={{ maxHeight: "75vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button — absolute top-right */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#9b9890]/50 hover:text-[#9b9890] transition-colors z-10"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Title — aligned with body */}
        <div className="px-5 pt-5 pb-3 flex-shrink-0">
          <input
            type="text"
            value={note.title}
            onChange={(e) => onUpdate(note.id, { title: e.target.value })}
            placeholder="Worldbuilding, character arc, story beats…"
            className="w-full bg-transparent text-[#e8e6e3] text-sm font-bold placeholder:text-[#9b9890]/35 focus:outline-none"
          />
        </div>

        <div className="h-px bg-[#2a2a2c] mx-5 flex-shrink-0" />

        {/* Body */}
        <div
          ref={bodyRef}
          contentEditable
          suppressContentEditableWarning
          onInput={() => onUpdate(note.id, { body: bodyRef.current?.innerHTML ?? "" })}
          onPaste={handlePaste}
          onKeyDown={handleBodyKeyDown}
          className="flex-1 overflow-y-auto px-5 py-4 text-sm text-[#e8e6e3] leading-relaxed focus:outline-none min-h-[140px] [&_em]:italic"
        />

        {/* Footer: arrows + counter */}
        {multi && (
          <div className="flex-shrink-0 border-t border-[#2a2a2c] py-2 flex items-center justify-center gap-4">
            <button
              onClick={() => onNavigate((index - 1 + notes.length) % notes.length)}
              className="text-[#9b9890] hover:text-[#e8e6e3] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
            <p className="text-[10px] text-[#9b9890]/35 tracking-wide tabular-nums">
              {index + 1} / {notes.length}
            </p>
            <button
              onClick={() => onNavigate((index + 1) % notes.length)}
              className="text-[#9b9890] hover:text-[#e8e6e3] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  chapter: Chapter;
  onAddImage: (chapterId: string, img: LibraryImage) => void;
  onRemoveImage: (chapterId: string, imgId: string) => void;
  onAddNote: (chapterId: string) => Promise<void>;
  onUpdateNote: (chapterId: string, noteId: string, patch: { title?: string; body?: string }) => void;
  onRemoveNote: (chapterId: string, noteId: string) => void;
  onAddMusicLink: (chapterId: string, link: { id: string; url: string; title: string; description: string; image: string }) => void;
  onRemoveMusicLink: (chapterId: string, linkId: string) => void;
  onClose?: () => void;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RightColumn({
  chapter,
  onAddImage,
  onRemoveImage,
  onAddNote,
  onUpdateNote,
  onRemoveNote,
  onAddMusicLink,
  onRemoveMusicLink,
  onClose,
}: Props) {
  const [imageLightboxIndex, setImageLightboxIndex] = useState<number | null>(null);
  const [noteLightboxIndex, setNoteLightboxIndex] = useState<number | null>(null);
  const [pendingOpenNote, setPendingOpenNote] = useState(false);
  const [draggingOver, setDraggingOver] = useState(false);
  const [musicModalOpen, setMusicModalOpen] = useState(false);
  const [musicUrl, setMusicUrl] = useState("");
  const [musicLoading, setMusicLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);

  // Focus music URL input when modal opens
  useEffect(() => {
    if (musicModalOpen) setTimeout(() => musicInputRef.current?.focus(), 50);
  }, [musicModalOpen]);

  // Open last note once it appears in the library after creation
  useEffect(() => {
    if (pendingOpenNote && chapter.library.notes.length > 0) {
      setNoteLightboxIndex(chapter.library.notes.length - 1);
      setPendingOpenNote(false);
    }
  }, [chapter.library.notes.length, pendingOpenNote]);

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

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDraggingOver(false);
    processImageFiles(e.dataTransfer.files);
  }

  async function handleAddNote() {
    setPendingOpenNote(true);
    await onAddNote(chapter.id);
  }

  async function handleMusicAdd() {
    const url = musicUrl.trim();
    if (!url || musicLoading) return;
    setMusicUrl("");
    setMusicLoading(true);

    let hostname = url;
    try { hostname = new URL(url).hostname.replace("www.", ""); } catch {}

    try {
      const res = await fetch(`/api/og?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      onAddMusicLink(chapter.id, {
        id: makeId(),
        url,
        title: data.title || hostname,
        description: data.description || "",
        image: data.image || "",
      });
    } catch {
      onAddMusicLink(chapter.id, { id: makeId(), url, title: hostname, description: "", image: "" });
    } finally {
      setMusicLoading(false);
      setMusicModalOpen(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#18181a] border-l border-[#1f1f21] w-full overflow-y-auto">
      {imageLightboxIndex !== null && chapter.library.images.length > 0 && (
        <Portal>
          <ImageLightbox
            images={chapter.library.images}
            index={imageLightboxIndex}
            onClose={() => setImageLightboxIndex(null)}
            onNavigate={setImageLightboxIndex}
          />
        </Portal>
      )}

      {noteLightboxIndex !== null && chapter.library.notes.length > 0 && (
        <Portal>
          <NoteLightbox
            notes={chapter.library.notes}
            index={noteLightboxIndex}
            onClose={() => setNoteLightboxIndex(null)}
            onNavigate={setNoteLightboxIndex}
            onUpdate={(noteId, patch) => onUpdateNote(chapter.id, noteId, patch)}
          />
        </Portal>
      )}

      <div className="px-4 pt-5 pb-2 flex-shrink-0 flex items-center justify-between">
        <Image src="/library.svg" alt="Library" width={16} height={16} className="opacity-50" />
        {onClose && (
          <button onClick={onClose} className="text-[#9b9890]/50 hover:text-[#9b9890] transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Images ── */}
      <div
        className={`mx-4 mb-3 rounded-lg border border-dashed transition-colors ${
          draggingOver ? "border-[#c4a882] bg-[#c4a882]/5" : "border-[#222224] hover:border-[#2a2a2c]"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDraggingOver(true); }}
        onDragLeave={() => setDraggingOver(false)}
        onDrop={handleDrop}
      >
        {chapter.library.images.length === 0 ? (
          <div
            className="py-5 flex flex-col items-center gap-2 cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <svg className="w-5 h-5 text-[#9b9890]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
            <span className="text-[10px] text-[#9b9890] uppercase tracking-widest">Drop images or click</span>
          </div>
        ) : (
          <div className="p-2 grid grid-cols-3 gap-1.5">
            {chapter.library.images.map((img, i) => (
              <div key={img.id} className="relative group aspect-square">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  className="w-full h-full object-cover rounded cursor-pointer"
                  onClick={() => setImageLightboxIndex(i)}
                />
                <button
                  onClick={(e) => { e.stopPropagation(); onRemoveImage(chapter.id, img.id); }}
                  className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/70 rounded-full items-center justify-center hidden group-hover:flex"
                >
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
            <button
              className="aspect-square rounded bg-[#1f1f21] flex items-center justify-center opacity-40 hover:opacity-100 transition-opacity"
              onClick={() => fileInputRef.current?.click()}
            >
              <Image src="/plus.svg" alt="Add image" width={14} height={14} />
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

      {/* ── Music modal ── */}
      {musicModalOpen && (
        <Portal>
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => { setMusicModalOpen(false); setMusicUrl(""); }}
        >
          <div
            className="bg-[#1c1c1e] rounded-2xl w-full max-w-sm p-5 shadow-2xl flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[11px] font-medium tracking-wide uppercase text-[#6b6966]">Add music link</p>
            <input
              ref={musicInputRef}
              type="url"
              placeholder="Paste a link…"
              value={musicUrl}
              onChange={(e) => setMusicUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleMusicAdd();
                if (e.key === "Escape") { setMusicModalOpen(false); setMusicUrl(""); }
              }}
              className="w-full bg-[#2a2a2c] text-[#e8e6e3] text-sm px-3 py-2.5 rounded-lg border border-[#333335] placeholder:text-[#9b9890]/40 focus:outline-none focus:border-[#c4a882]/60 transition-colors"
            />
            <button
              onClick={handleMusicAdd}
              disabled={musicLoading || !musicUrl.trim()}
              className="w-full py-2.5 rounded-lg bg-[#c4a882] text-[#18181a] text-sm font-semibold tracking-wide hover:bg-[#d4b892] disabled:opacity-40 transition-colors"
            >
              {musicLoading ? "Please wait…" : "Add"}
            </button>
          </div>
        </div>
        </Portal>
      )}

      {/* ── Music ── */}
      <div className="px-4 mb-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-medium tracking-wide uppercase text-[#6b6966]">Music</p>
          <button
            className="opacity-40 hover:opacity-100 transition-opacity"
            onClick={() => setMusicModalOpen(true)}
          >
            <Image src="/plus.svg" alt="Add music link" width={14} height={14} />
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
                <div className="w-9 h-9 rounded bg-[#222224] flex-shrink-0 overflow-hidden flex items-center justify-center">
                  {link.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={link.image} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <svg className="w-4 h-4 text-[#9b9890]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[#e8e6e3] truncate">{link.title}</p>
                  {link.description ? (
                    <p className="text-[10px] text-[#9b9890] truncate">{link.description}</p>
                  ) : (
                    <p className="text-[10px] text-[#9b9890]/50 truncate">
                      {(() => { try { return new URL(link.url).hostname.replace("www.", ""); } catch { return link.url; } })()}
                    </p>
                  )}
                </div>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 text-[#9b9890] hover:text-[#c4a882] transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                  </svg>
                </a>
                <button
                  onClick={() => onRemoveMusicLink(chapter.id, link.id)}
                  className="hidden group-hover:flex text-[#9b9890] hover:text-red-400 transition-colors flex-shrink-0"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Notes ── */}
      <div className="px-4 pb-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-medium tracking-wide uppercase text-[#6b6966]">Notes</p>
          <button
            className="opacity-40 hover:opacity-100 transition-opacity"
            onClick={handleAddNote}
          >
            <Image src="/plus.svg" alt="Add note" width={14} height={14} />
          </button>
        </div>
        {chapter.library.notes.length === 0 ? (
          <p className="text-[11px] text-[#9b9890]/40 italic">No notes yet</p>
        ) : (
          <div className="flex flex-col gap-1">
            {chapter.library.notes.map((note, i) => (
              <div
                key={note.id}
                className="flex items-center gap-2 group px-2 py-1.5 rounded hover:bg-[#1f1f21] transition-colors cursor-pointer"
                onClick={() => setNoteLightboxIndex(i)}
              >
                <svg className="w-3.5 h-3.5 text-[#9b9890]/50 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <span className="text-xs flex-1 truncate">
                  {note.title
                    ? <span className="text-[#e8e6e3]">{note.title}</span>
                    : <span className="text-[#9b9890]/35 italic">Untitled note</span>
                  }
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); onRemoveNote(chapter.id, note.id); }}
                  className="hidden group-hover:flex text-[#9b9890] hover:text-red-400 transition-colors flex-shrink-0"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
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
