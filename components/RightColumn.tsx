"use client";

import { Fragment, useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Chapter, LibraryImage, LibraryNote, LibraryLink } from "@/lib/types";
import { DropLine } from "@/components/ui/DropLine";
import { useReorderList } from "@/lib/useReorderList";
import { useReorderGrid } from "@/lib/useReorderGrid";
import { useAutoScrollOnDrag } from "@/lib/useAutoScrollOnDrag";
import { SharingMenu } from "@/components/sharing/SharingMenu";
import { chapterWordCount } from "@/lib/words";
import { EditorComments } from "@/components/sharing/EditorComments";
import { Badge } from "@/components/ui/Badge";
import { useUnread } from "@/lib/useUnread";
import { useShareState } from "@/lib/useShareState";

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

// Comment cards sit in a px-4 (16px) container inside the Comments layer, the
// same inset as the header icons' left-4 — so at rest the Comments icon and the
// cards' left edges line up. The header slide tracks this card edge, not the
// layer's outer padding edge (§5.3).
const CARD_INSET = 16;

// Evaluate a CSS cubic-bezier timing function (y for a given progress x). Used
// to sample the *content's* ease-out curve so the header Comments icon can be
// keyframed to ride the cards' left edge exactly — the icon and the content
// layer must share this identical curve. Matches ease-[cubic-bezier(0,0,0.2,1)]
// on the content layers below.
function makeCubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;
  const sampleDX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 8; i++) {
      const x = sampleX(u) - t;
      if (Math.abs(x) < 1e-6) break;
      const d = sampleDX(u);
      if (Math.abs(d) < 1e-6) break;
      u -= x / d;
    }
    return sampleY(u);
  };
}
const easeOut = makeCubicBezier(0, 0, 0.2, 1);

// ── Image lightbox ────────────────────────────────────────────────────────────

// Makes the browser back button close the lightbox instead of navigating away.
// Returns a requestClose() that UI close actions (backdrop, ×, Escape) should call
// so that popstate is the single source of truth — this keeps the history entry in
// sync and stays correct under React StrictMode's double effect invocation in dev.
function useLightboxHistory(onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    // Guard so StrictMode's setup→cleanup→setup doesn't push two entries.
    if (!window.history.state?._lightbox) {
      window.history.pushState({ _lightbox: true }, "");
    }
    const onPop = () => onCloseRef.current();
    window.addEventListener("popstate", onPop);
    // No history manipulation in cleanup — doing so fires a stray popstate that the
    // remounted listener would catch, instantly re-closing the lightbox.
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return useCallback(() => {
    // Pop our entry; the popstate listener then runs onClose. Falls back to a direct
    // close if our entry isn't on top for some reason.
    if (window.history.state?._lightbox) window.history.back();
    else onCloseRef.current();
  }, []);
}

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
  const requestClose = useLightboxHistory(onClose);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") onNavigate((index + 1) % images.length);
      else if (e.key === "ArrowLeft") onNavigate((index - 1 + images.length) % images.length);
      else if (e.key === "Escape") requestClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [index, images.length, requestClose, onNavigate]);

  return (
    <div
      className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center cursor-pointer"
      onClick={requestClose}
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

  const requestClose = useLightboxHistory(onClose);

  // Sync body HTML whenever the active note changes
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.innerHTML = note.body;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  // Escape to close; ←/→ to cycle notes (only when not typing in a field, so the
  // arrows still move the caret inside the title input or note body while editing)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { requestClose(); return; }
      if (notes.length < 2) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowLeft") onNavigate((index - 1 + notes.length) % notes.length);
      if (e.key === "ArrowRight") onNavigate((index + 1) % notes.length);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose, index, notes.length, onNavigate]);

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }

  function syncBody() {
    onUpdate(note.id, { body: bodyRef.current?.innerHTML ?? "" });
  }

  function handleBodyKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Markdown-style list autodetect: typing a marker ("1.", "-", "*", "+")
    // followed by a space at the very start of a line turns it into a real
    // ordered/unordered list, matching Google Docs / Notion.
    if (e.key === " ") {
      const sel = window.getSelection();
      if (sel && sel.isCollapsed && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        const node = range.startContainer;
        if (node.nodeType === Node.TEXT_NODE) {
          const before = (node.textContent ?? "").slice(0, range.startOffset);
          const marker = /^(1\.|[-*+])$/.exec(before);
          if (marker) {
            e.preventDefault();
            // Remove the typed marker before converting the line to a list.
            const del = document.createRange();
            del.setStart(node, 0);
            del.setEnd(node, range.startOffset);
            del.deleteContents();
            document.execCommand(
              marker[1] === "1." ? "insertOrderedList" : "insertUnorderedList",
            );
            syncBody();
            return;
          }
        }
      }
    }

    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    // Apply bold/italic ourselves rather than relying on the browser default.
    // Some browsers (e.g. Firefox) bind Cmd/Ctrl+I to a chrome feature ("Page
    // Info") and never toggle italic in the editor. preventDefault suppresses
    // that so formatting always wins, matching Google Docs' behavior.
    if (key === "i" || key === "b") {
      e.preventDefault();
      document.execCommand(key === "i" ? "italic" : "bold");
      syncBody();
      return;
    }
    // Block every other formatting shortcut; keep clipboard/undo/select-all.
    if (!["z", "a", "c", "x", "v"].includes(key)) {
      e.preventDefault();
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4"
      onClick={requestClose}
    >
      <div
        className="relative bg-panel rounded-2xl w-full max-w-lg flex flex-col shadow-2xl overflow-hidden"
        style={{ maxHeight: "75vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button — absolute top-right */}
        <button
          onClick={requestClose}
          className="absolute top-4 right-4 text-subtle/50 hover:text-subtle transition-colors z-10"
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
            autoComplete="off"
            autoCorrect="on"
            autoCapitalize="sentences"
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            className="w-full bg-transparent text-text text-base font-bold placeholder:text-subtle/35 focus:outline-none"
          />
        </div>

        <div className="h-px bg-border-subtle mx-5 flex-shrink-0" />

        {/* Body */}
        <div
          ref={bodyRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          // Freeform prose — signal a plain text editor and opt out of autofill
          // so iOS doesn't pop its password/card/contact AutoFill bar (see the
          // matching note in CenterColumn's scene body).
          autoCorrect="on"
          autoCapitalize="sentences"
          spellCheck
          // autoComplete isn't in React's div prop types (form-elements only),
          // but the DOM attribute is honored on contentEditable — spread it in.
          {...({ autoComplete: "off" } as Record<string, string>)}
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          onInput={() => onUpdate(note.id, { body: bodyRef.current?.innerHTML ?? "" })}
          onPaste={handlePaste}
          onKeyDown={handleBodyKeyDown}
          className="flex-1 overflow-y-auto px-5 py-4 text-sm text-text leading-relaxed focus:outline-none min-h-[140px] [&_em]:italic [&_i]:italic [&_b]:font-bold [&_strong]:font-bold [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:my-0.5"
        />
      </div>
    </div>
  );
}

// ── Image upload modal ────────────────────────────────────────────────────────

function ImageUploadModal({
  onFiles,
  onUrl,
  onClose,
}: {
  onFiles: (files: FileList) => void;
  onUrl: (url: string) => Promise<void>;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => urlInputRef.current?.focus(), 50);
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleUrlSubmit() {
    const trimmed = url.trim();
    if (!trimmed || urlLoading) return;
    setUrlError("");
    setUrlLoading(true);
    try {
      await onUrl(trimmed);
      onClose();
    } catch {
      setUrlError("Couldn't load that image. Check the URL and try again.");
    } finally {
      setUrlLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-panel rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <p className="text-[11px] font-medium tracking-wide uppercase text-muted">Add image</p>
          <button onClick={onClose} className="text-subtle/50 hover:text-muted transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 pb-5 flex flex-col gap-3">
          {/* URL input */}
          <div className="flex gap-2">
            <input
              ref={urlInputRef}
              type="url"
              placeholder="https://example.com/image.jpg"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setUrlError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleUrlSubmit(); }}
              className="flex-1 min-w-0 bg-bg text-text text-sm px-3 py-2 rounded-lg border border-hover placeholder:text-subtle/50 focus:outline-none focus:border-accent/60 transition-colors"
            />
            <button
              onClick={handleUrlSubmit}
              disabled={urlLoading || !url.trim()}
              className="px-3 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:bg-accent-hi disabled:opacity-40 transition-colors flex-shrink-0"
            >
              {urlLoading ? "…" : "Add"}
            </button>
          </div>
          {urlError && <p className="text-[11px] text-error">{urlError}</p>}

          {/* Drop / upload zone */}
          <div
            className={`rounded-xl border-2 border-dashed py-7 flex flex-col items-center gap-2 cursor-pointer transition-colors ${
              dragging ? "border-accent bg-accent/5" : "border-hover hover:border-subtle"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (e.dataTransfer.files.length) { onFiles(e.dataTransfer.files); onClose(); }
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <svg className="w-5 h-5 text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <span className="text-[11px] text-muted tracking-wide">Drop image here or click to upload</span>
            <span className="text-[10px] text-subtle/60">Or paste (⌘V) anywhere</span>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files?.length) { onFiles(e.target.files); onClose(); } }}
        />
      </div>
    </div>
  );
}

// ── Link List Item ────────────────────────────────────────────────────────────

// A research link. The whole row is an anchor that opens the URL in a new tab;
// the favicon (sized to match Note icons), page title, and site name come from
// the OG scrape. On hover the site name is replaced by a remove button.
function LinkListItem({ link, onRemove }: { link: LibraryLink; onRemove: () => void }) {
  const [iconFailed, setIconFailed] = useState(false);
  const showFavicon = link.favicon && !iconFailed;

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2.5 group px-2 py-1.5 rounded hover:bg-panel transition-colors"
    >
      <span className="w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center">
        {showFavicon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={link.favicon}
            alt=""
            className="w-3.5 h-3.5 rounded-sm object-contain"
            onError={() => setIconFailed(true)}
          />
        ) : (
          <svg className="w-3.5 h-3.5 text-subtle/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
          </svg>
        )}
      </span>
      <span className="text-body-m text-text flex-1 truncate">
        {link.title || link.siteName || link.url}
      </span>
      <span className="text-body-s text-subtle flex-shrink-0 max-w-[40%] truncate group-hover:hidden">
        {link.siteName}
      </span>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
        className="hidden group-hover:flex text-subtle hover:text-error transition-colors flex-shrink-0"
        aria-label="Remove link"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </a>
  );
}

// ── Gallery image cell with skeleton loading ─────────────────────────────────

function GalleryImage({
  img,
  cellProps,
  highlighted,
  onOpen,
  onRemove,
  onLoad,
  onError,
}: {
  img: LibraryImage;
  index: number;
  cellProps: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
  highlighted: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onLoad: () => void;
  onError: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const prevSrc = useRef(img.dataUrl);
  if (prevSrc.current !== img.dataUrl) {
    prevSrc.current = img.dataUrl;
    setLoaded(false);
  }

  return (
    <div
      {...cellProps}
      className={`relative group aspect-square rounded ${
        highlighted ? "ring-2 ring-accent" : ""
      } ${loaded ? "" : "bg-panel animate-pulse"}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={img.dataUrl}
        alt={img.name}
        className={`w-full h-full object-cover rounded cursor-pointer transition-opacity duration-300 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
        onClick={onOpen}
        draggable={false}
        onLoad={() => { setLoaded(true); onLoad(); }}
        onError={onError}
      />
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/70 rounded-full items-center justify-center hidden group-hover:flex"
      >
        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  chapter: Chapter;
  loading?: boolean;
  onAddImage: (chapterId: string, img: LibraryImage) => void;
  onRemoveImage: (chapterId: string, imgId: string) => void;
  onRefreshImage: (chapterId: string, imgId: string) => void;
  onAddNote: (chapterId: string) => Promise<LibraryNote>;
  onUpdateNote: (chapterId: string, noteId: string, patch: { title?: string; body?: string }) => void;
  onRemoveNote: (chapterId: string, noteId: string) => void;
  onAddMusicLink: (chapterId: string, link: { id: string; url: string; title: string; description: string; image: string }) => void;
  onRemoveMusicLink: (chapterId: string, linkId: string) => void;
  onAddLink: (chapterId: string, link: LibraryLink) => void;
  onRemoveLink: (chapterId: string, linkId: string) => void;
  linksVisible?: boolean;
  onReorderImages: (chapterId: string, from: number, to: number) => void;
  onReorderMusicLinks: (chapterId: string, from: number, to: number) => void;
  onReorderNotes: (chapterId: string, from: number, to: number) => void;
  onClose?: () => void;
  // When true, show the sharing mini-menu at the column's bottom-right (§3.6)
  // and the Comments tab next to the Library icon (§3.7). False for the hidden
  // Book-Info chapter.
  shareable?: boolean;
  // The signed-in author — decides who may resolve/edit in the Comments tab.
  currentUserId?: string | null;
  // Scrolls the editor to a live scene when a comment card is clicked (§3.7).
  onSceneClick?: (chapterId: string, sceneId: string) => void;
  // Delete the chapter — the Chapter Menu (§3.6 / Stage 8) offers it too.
  onDeleteChapter?: (chapterId: string) => void;
  // "Show stats" — an account-wide toggle (not per-chapter). When on, a chapter
  // word-count card sits above the Chapter Menu row. Lived in the writer page so
  // it stays on as you move between chapters.
  showChapterStats?: boolean;
  onToggleChapterStats?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  // Pixel width of the expanded panel — the body below the header renders at
  // this fixed width always (see the body wrapper below) so collapsing never
  // visibly resizes its contents; only the enclosing column's overflow-hidden
  // width and this fade change.
  expandedWidth?: number;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RightColumn({
  chapter,
  loading = false,
  onAddImage,
  onRemoveImage,
  onRefreshImage,
  onAddNote,
  onUpdateNote,
  onRemoveNote,
  onAddMusicLink,
  onRemoveMusicLink,
  onAddLink,
  onRemoveLink,
  linksVisible = true,
  onReorderImages,
  onReorderMusicLinks,
  onReorderNotes,
  onClose,
  shareable = false,
  currentUserId,
  onSceneClick,
  onDeleteChapter,
  showChapterStats = false,
  onToggleChapterStats,
  collapsed,
  onToggleCollapse,
  expandedWidth,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Comments (and its header icon) only exist once the chapter has actually been
  // shared — `shareable` merely means it *can* be shared (Book Info can't, and
  // forces Library). An unshared-but-shareable chapter shows no Comments icon.
  const { shared } = useShareState(chapter.id);
  const commentsAvailable = shareable && shared;
  // Library ↔ Comments tab (§3.7).
  const [activeTab, setActiveTab] = useState<"library" | "comments">("library");
  useEffect(() => {
    if (!commentsAvailable) setActiveTab("library");
  }, [commentsAvailable]);
  const showComments = commentsAvailable && activeTab === "comments";
  // Horizontal travel (px) of the header's Comments icon as it slides between
  // the right slot (Library view) and the left slot (Comments view). The left
  // and right icon boxes are 28px (p-1 + 20px glyph) inset by px-4 (16px), so
  // the gap between their left edges is width − 16 − 28 − 16 = width − 60.
  const commentTravel = Math.max(0, (expandedWidth ?? 0) - 60);

  const SLIDE_MS = 400;
  const commentIconRef = useRef<HTMLDivElement>(null);

  // Two layouts share this component: the desktop side panel (collapsible, tabs
  // cross-slide, §3.7 / 5.3) and the mobile full-screen panel (an X returns to
  // Write). The collapse capability is the desktop tell.
  const isMobilePanel = !onToggleCollapse;

  // Ride the incoming content's leading edge with the header Comments icon on
  // each tab switch (§5.3). A plain transition can't both hold the icon in a
  // slot and then follow an *eased* edge, so we keyframe the icon: sample the
  // same ease-out curve the content uses, turn each sample into the edge the
  // icon should chase, clamp it to the icon's travel band, and let the Web
  // Animations API play those positions. The icon waits, meets the content
  // exactly, then decelerates into its target slot in lockstep with it.
  //   • Open  — the Comments cards enter from the right; their LEFT edge leads,
  //             and the icon's LEFT edge follows it into the left slot.
  //   • Close — the Library content enters from the left; its RIGHT edge leads,
  //             and the icon's RIGHT edge follows it back into the right slot.
  // Both content and icon are inset 16px (CARD_INSET) from the same side, so at
  // rest the tracked edges coincide, making the two directions mirror images.
  const prevShowComments = useRef<boolean | null>(null);
  useEffect(() => {
    if (isMobilePanel || !commentsAvailable) { prevShowComments.current = showComments; return; }
    const el = commentIconRef.current;
    const W = expandedWidth ?? 0;
    const prev = prevShowComments.current;
    prevShowComments.current = showComments;
    // Only animate a real Library↔Comments flip — not the initial mount or an
    // unrelated re-render (e.g. a resize while the tab is already settled).
    if (prev === null || prev === showComments || !el || !W) return;
    const N = 30;
    const frames: Keyframe[] = [];
    for (let i = 0; i <= N; i++) {
      const e = easeOut(i / N);
      let tx: number;
      if (showComments) {
        // Comments layer left edge sweeps W → 0; track the cards' left edge.
        const cardLeft = W * (1 - e) + CARD_INSET;
        tx = Math.min(Math.max(cardLeft, 16), W - 44) - 16;
      } else {
        // Library layer right edge sweeps 0 → W; track the content's right edge.
        const contentRight = W * e - CARD_INSET;
        tx = Math.min(Math.max(contentRight, 44), W - 16) - 44;
      }
      frames.push({ transform: `translateX(${tx}px)` });
    }
    const anim = el.animate(frames, { duration: SLIDE_MS, easing: "linear", fill: "none" });
    return () => anim.cancel();
  }, [showComments, commentsAvailable, isMobilePanel, expandedWidth]);

  // Unread comments on THIS chapter drive the Comments-tab count + the collapsed
  // library-icon dot (§6). Cleared when the tab opens (EditorComments marks seen
  // → refreshUnread). Book Info isn't shareable, so it never shows a badge.
  const { chapters: unreadChapters } = useUnread();
  const chapterCounts = shareable
    ? unreadChapters.find((c) => c.chapterId === chapter.id)
    : undefined;
  const unreadComments = chapterCounts?.unreadComments ?? 0;
  // Total comments on the chapter — drives the dim resting badge when nothing is
  // new (§6). New comments take over with the bright unread badge instead.
  const totalComments = chapterCounts?.totalComments ?? 0;

  // Clicking the active tab collapses/expands the panel (preserving the old
  // click-the-library-icon-to-collapse gesture); clicking the other switches to
  // it, expanding first if collapsed.
  function selectTab(tab: "library" | "comments") {
    if (tab === activeTab) {
      onToggleCollapse?.();
      return;
    }
    setActiveTab(tab);
    if (collapsed) onToggleCollapse?.();
  }
  useAutoScrollOnDrag(scrollRef);
  const imageReorder = useReorderGrid((from, to) => onReorderImages(chapter.id, from, to));
  const musicReorder = useReorderList((from, to) => onReorderMusicLinks(chapter.id, from, to));
  const noteReorder = useReorderList((from, to) => onReorderNotes(chapter.id, from, to));
  const [imageLightboxIndex, setImageLightboxIndex] = useState<number | null>(null);
  const [noteLightboxIndex, setNoteLightboxIndex] = useState<number | null>(null);
  const [pendingNoteId, setPendingNoteId] = useState<string | null>(null);
  const [draggingOver, setDraggingOver] = useState(false);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [musicModalOpen, setMusicModalOpen] = useState(false);
  const [musicUrl, setMusicUrl] = useState("");
  const [musicLoading, setMusicLoading] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  // Image ids we've already asked to re-sign once, so a still-broken URL can't
  // loop onError → refresh → onError. Cleared per-image on a successful load,
  // re-arming it for a future expiry.
  const retriedImageIds = useRef<Set<string>>(new Set());

  // Focus music URL input when modal opens
  useEffect(() => {
    if (musicModalOpen) setTimeout(() => musicInputRef.current?.focus(), 50);
  }, [musicModalOpen]);

  // Focus link URL input when modal opens
  useEffect(() => {
    if (linkModalOpen) setTimeout(() => linkInputRef.current?.focus(), 50);
  }, [linkModalOpen]);

  // Open the newly created note once it appears in the library. Matching by id
  // (not array length) avoids a race where the effect fires before the note is
  // appended and opens a pre-existing note instead.
  useEffect(() => {
    if (!pendingNoteId) return;
    const idx = chapter.library.notes.findIndex((n) => n.id === pendingNoteId);
    if (idx !== -1) {
      setNoteLightboxIndex(idx);
      setPendingNoteId(null);
    }
  }, [chapter.library.notes, pendingNoteId]);

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

  const processImageUrl = useCallback(
    async (url: string) => {
      // Proxy through server to avoid CORS
      const res = await fetch(`/api/image?url=${encodeURIComponent(url)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const filename = url.split("/").pop()?.split("?")[0] || "image.jpg";
      onAddImage(chapter.id, { id: makeId(), name: filename, dataUrl });
    },
    [chapter.id, onAddImage]
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDraggingOver(false);
    processImageFiles(e.dataTransfer.files);
  }

  async function handleAddNote() {
    const saved = await onAddNote(chapter.id);
    setPendingNoteId(saved.id);
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

  async function handleLinkAdd() {
    const url = linkUrl.trim();
    if (!url || linkLoading) return;
    setLinkUrl("");
    setLinkLoading(true);

    let hostname = url;
    try { hostname = new URL(url).hostname.replace("www.", ""); } catch {}

    try {
      const res = await fetch(`/api/og?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      onAddLink(chapter.id, {
        id: makeId(),
        url,
        title: data.title || hostname,
        siteName: data.siteName || hostname,
        favicon: data.favicon || "",
      });
    } catch {
      onAddLink(chapter.id, { id: makeId(), url, title: hostname, siteName: hostname, favicon: "" });
    } finally {
      setLinkLoading(false);
      setLinkModalOpen(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-bg border-l border-border-subtle w-full">
      {imageModalOpen && (
        <Portal>
          <ImageUploadModal
            onFiles={processImageFiles}
            onUrl={processImageUrl}
            onClose={() => setImageModalOpen(false)}
          />
        </Portal>
      )}

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

      {/* Panel Header — Library / Comments tabs (§3.7), always visible. Fixed
          h-16 so the Gallery top lines up with the Book Cover and the first
          Scene. This header is a sibling before the scrollable body, not part of
          that scroll, so it never needs to be sticky and never fades with it. */}
      <div className="relative bg-bg h-16 px-4 flex-shrink-0 flex items-center justify-between">
        {isMobilePanel ? (
          <>
            {/* Mobile — both tab icons on the left, X on the right returns to the
                Write view (unchanged; the spec keeps mobile as-is). */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => selectTab("library")}
                className={`relative p-1 rounded-md transition-opacity ${
                  activeTab === "library" ? "opacity-100" : "opacity-40 hover:opacity-100"
                }`}
                aria-label="Library"
              >
                <Image src="/library.svg" alt="Library" width={20} height={20} />
              </button>
              {commentsAvailable && (
                <button
                  onClick={() => selectTab("comments")}
                  className={`relative p-1 rounded-md transition-opacity ${
                    activeTab === "comments"
                      ? "opacity-100 text-text"
                      : "opacity-40 hover:opacity-100 text-subtle"
                  }`}
                  aria-label="Comments"
                >
                  <CommentsGlyph />
                  {/* Count badge fades out once Comments is open (kept mounted,
                      toggled by opacity); new → bright unread, else dim total. */}
                  {(unreadComments > 0 || totalComments > 0) && (
                    <Badge
                      count={unreadComments > 0 ? unreadComments : totalComments}
                      variant={unreadComments > 0 ? "accent" : "muted"}
                      className={`absolute -top-1.5 -right-2 transition-opacity duration-[400ms] ease-in-out ${
                        showComments ? "opacity-0" : "opacity-100"
                      }`}
                    />
                  )}
                </button>
              )}
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="text-subtle/50 hover:text-subtle transition-colors"
                aria-label="Close"
              >
                <CloseGlyph />
              </button>
            )}
          </>
        ) : (
          <>
            {/* Desktop (5.3) — an animated three-glyph header. The Library icon
                sits at the left slot, the X at the right slot, and the Comments
                icon travels between them: it rests in the right slot while
                Library is up and slides across to the left slot when Comments
                opens, moving in step with the body's cross-slide. As it slides,
                the Library icon fades out beneath it and the X fades in at the
                right. Whichever icon holds the left slot doubles as the collapse
                toggle. The Comments icon exists only once the chapter is shared. */}

            {/* Library icon — left slot; collapse toggle while Library is up.
                Fades out as Comments opens. */}
            <div
              className="absolute inset-y-0 left-4 flex items-center transition-opacity duration-[400ms] ease-in-out"
              style={{ opacity: showComments ? 0 : 1, pointerEvents: showComments ? "none" : undefined }}
            >
              <button
                onClick={() => selectTab("library")}
                className="relative p-1 rounded-md text-text hover:opacity-80 transition-opacity"
                title={collapsed ? "Expand panel" : "Collapse panel"}
                aria-label="Library"
              >
                <Image src="/library.svg" alt="Library" width={20} height={20} />
                {/* Collapsed hides the right affordance — surface unread here (§6). */}
                {collapsed && !showComments && unreadComments > 0 && (
                  <Badge dot className="absolute top-0 right-0" />
                )}
              </button>
            </div>

            {/* Comments icon — slides between the right slot (Library view) and
                the left slot (Comments view). Hidden when the panel is collapsed
                on the Library view, where the rail shows just the single toggle. */}
            {commentsAvailable && (
              <div
                ref={commentIconRef}
                className="absolute inset-y-0 left-4 flex items-center"
                style={{
                  transform: `translateX(${showComments ? 0 : commentTravel}px)`,
                  opacity: !collapsed || showComments ? 1 : 0,
                  pointerEvents: !collapsed || showComments ? undefined : "none",
                  // Base transition: the close move + fallback. The open move is
                  // driven by the keyframe effect above, which overrides this.
                  transition: `transform ${SLIDE_MS}ms ease-out, opacity ${SLIDE_MS}ms ease-in-out`,
                }}
              >
                <button
                  onClick={() => selectTab("comments")}
                  className="relative p-1 rounded-md text-subtle hover:opacity-80 transition-opacity"
                  title={showComments ? (collapsed ? "Expand panel" : "Collapse panel") : "Comments"}
                  aria-label="Comments"
                >
                  <CommentsGlyph />
                  {/* Count badge — a wayfinding cue toward the tab. It fades out
                      once Comments is open (the cards are right there) and back
                      in on Library, so it's kept mounted and toggled by opacity.
                      New comments → bright unread count; otherwise a dim total. */}
                  {!collapsed && (unreadComments > 0 || totalComments > 0) && (
                    <Badge
                      count={unreadComments > 0 ? unreadComments : totalComments}
                      variant={unreadComments > 0 ? "accent" : "muted"}
                      className={`absolute -top-1.5 -right-2 transition-opacity duration-[400ms] ease-in-out ${
                        showComments ? "opacity-0" : "opacity-100"
                      }`}
                    />
                  )}
                  {collapsed && showComments && unreadComments > 0 && (
                    <Badge dot className="absolute top-0 right-0" />
                  )}
                </button>
              </div>
            )}

            {/* Close (X) — right slot; fades in over the Comments icon's vacated
                slot and returns to Library. */}
            {commentsAvailable && (
              <div
                className="absolute inset-y-0 right-4 flex items-center transition-opacity duration-[400ms] ease-in-out"
                style={{
                  opacity: showComments && !collapsed ? 1 : 0,
                  pointerEvents: showComments && !collapsed ? undefined : "none",
                }}
              >
                <button
                  onClick={() => selectTab("library")}
                  className="p-1 rounded-md text-subtle/60 hover:text-subtle transition-colors"
                  title="Back to library"
                  aria-label="Close comments"
                >
                  <CloseGlyph />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Body — fixed to the expanded width and faded via `collapsed`, independently
          of the enclosing column's own (animating) width. This is what lets the
          collapse/expand run as a pure fade: the body's layout never changes size,
          it's just progressively revealed or hidden by the ancestor's overflow-hidden
          as that column width tweens, concurrently with this opacity. */}
      <div
        className="relative flex-1 overflow-hidden"
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

      {/* Library layer — always mounted so returning from Comments never remounts
          (and re-flashes) the image thumbnails. Slides left + fades out beneath
          the Comments layer when the Comments tab is up (5.3). */}
      <div
        ref={scrollRef}
        className={`absolute inset-0 overflow-y-auto transition-[translate,opacity] duration-[400ms] ease-[cubic-bezier(0,0,0.2,1)] ${
          showComments ? "-translate-x-full opacity-0 pointer-events-none" : "translate-x-0 opacity-100"
        }`}
        aria-hidden={showComments}
      >
      <>

      {/* ── Images ── */}
      {loading ? (
        <div className="mx-4 mt-4 mb-3 p-2 grid grid-cols-3 gap-1.5" aria-hidden>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="aspect-square rounded bg-panel animate-pulse" />
          ))}
        </div>
      ) : (
      <div
        className={`mx-4 mt-4 mb-3 rounded-lg border border-dashed ${
          draggingOver ? "border-accent bg-accent/5" : "border-border-subtle hover:border-hover"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDraggingOver(true); }}
        onDragLeave={() => setDraggingOver(false)}
        onDrop={handleDrop}
      >
        {chapter.library.images.length === 0 ? (
          <div
            className="py-5 flex flex-col items-center gap-2 cursor-pointer"
            onClick={() => setImageModalOpen(true)}
          >
            <svg className="w-5 h-5 text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
            <span className="text-[10px] text-subtle uppercase tracking-widest">Drop images or click</span>
          </div>
        ) : (
          <div className="p-2 grid grid-cols-3 gap-1.5">
            {chapter.library.images.map((img, i) => (
              <GalleryImage
                key={img.id}
                img={img}
                index={i}
                cellProps={imageReorder.cellProps(i)}
                highlighted={imageReorder.overIndex === i}
                onOpen={() => setImageLightboxIndex(i)}
                onRemove={() => onRemoveImage(chapter.id, img.id)}
                onLoad={() => retriedImageIds.current.delete(img.id)}
                onError={() => {
                  if (!img.path || retriedImageIds.current.has(img.id)) return;
                  retriedImageIds.current.add(img.id);
                  onRefreshImage(chapter.id, img.id);
                }}
              />
            ))}
            <button
              className="aspect-square rounded bg-panel flex items-center justify-center opacity-40 hover:opacity-100 transition-opacity"
              onClick={() => setImageModalOpen(true)}
            >
              <Image src="/plus.svg" alt="Add image" width={14} height={14} />
            </button>
          </div>
        )}
      </div>
      )}

      {/* ── Music modal ── */}
      {musicModalOpen && (
        <Portal>
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => { setMusicModalOpen(false); setMusicUrl(""); }}
        >
          <div
            className="bg-panel rounded-2xl w-full max-w-sm p-5 shadow-2xl flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[11px] font-medium tracking-wide uppercase text-muted">Add music link</p>
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
              className="w-full bg-bg text-text text-base px-3 py-2.5 rounded-lg border border-hover placeholder:text-subtle/50 focus:outline-none focus:border-accent/60 transition-colors"
            />
            <button
              onClick={handleMusicAdd}
              disabled={musicLoading || !musicUrl.trim()}
              className="w-full py-2.5 rounded-lg bg-accent text-on-accent text-sm font-semibold tracking-wide hover:bg-accent-hi disabled:opacity-40 transition-colors"
            >
              {musicLoading ? "Please wait…" : "Add"}
            </button>
          </div>
        </div>
        </Portal>
      )}

      {/* ── Link modal ── */}
      {linkModalOpen && (
        <Portal>
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => { setLinkModalOpen(false); setLinkUrl(""); }}
        >
          <div
            className="bg-panel rounded-2xl w-full max-w-sm p-5 shadow-2xl flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[11px] font-medium tracking-wide uppercase text-muted">Add link</p>
            <input
              ref={linkInputRef}
              type="url"
              placeholder="Paste a link…"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleLinkAdd();
                if (e.key === "Escape") { setLinkModalOpen(false); setLinkUrl(""); }
              }}
              className="w-full bg-bg text-text text-base px-3 py-2.5 rounded-lg border border-hover placeholder:text-subtle/50 focus:outline-none focus:border-accent/60 transition-colors"
            />
            <button
              onClick={handleLinkAdd}
              disabled={linkLoading || !linkUrl.trim()}
              className="w-full py-2.5 rounded-lg bg-accent text-on-accent text-sm font-semibold tracking-wide hover:bg-accent-hi disabled:opacity-40 transition-colors"
            >
              {linkLoading ? "Please wait…" : "Add"}
            </button>
          </div>
        </div>
        </Portal>
      )}

      {/* ── Music ── */}
      <div className="px-4 mb-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-label-m uppercase text-subtle">Music</p>
          <button
            className="opacity-40 hover:opacity-100 transition-opacity"
            onClick={() => setMusicModalOpen(true)}
          >
            <Image src="/plus.svg" alt="Add music link" width={14} height={14} />
          </button>
        </div>
        {chapter.library.musicLinks.length > 0 && (
          <div className="flex flex-col" {...musicReorder.containerProps()}>
            {chapter.library.musicLinks.map((link, i) => (
              <Fragment key={link.id}>
                <DropLine active={musicReorder.activeGap === i} />
                <div
                  {...musicReorder.dragHandleProps(i)}
                  {...musicReorder.dropZoneProps(i)}
                  className="flex items-center gap-2.5 group bg-panel rounded-lg px-3 py-2 mb-2 last:mb-0 hover:bg-hover transition-colors cursor-grab active:cursor-grabbing"
                >
                <div className="w-9 h-9 rounded bg-hover flex-shrink-0 overflow-hidden flex items-center justify-center">
                  {link.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={link.image} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <svg className="w-4 h-4 text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-text truncate">{link.title}</p>
                  {link.description ? (
                    <p className="text-[10px] text-subtle truncate">{link.description}</p>
                  ) : (
                    <p className="text-[10px] text-subtle/50 truncate">
                      {(() => { try { return new URL(link.url).hostname.replace("www.", ""); } catch { return link.url; } })()}
                    </p>
                  )}
                </div>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 text-subtle hover:text-accent transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                  </svg>
                </a>
                <button
                  onClick={() => onRemoveMusicLink(chapter.id, link.id)}
                  className="hidden group-hover:flex text-subtle hover:text-error transition-colors flex-shrink-0"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                </div>
              </Fragment>
            ))}
            <DropLine active={musicReorder.activeGap === chapter.library.musicLinks.length} />
          </div>
        )}
      </div>

      {/* ── Notes ── */}
      <div className="px-4 mb-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-label-m uppercase text-subtle">Notes</p>
          <button
            className="opacity-40 hover:opacity-100 transition-opacity"
            onClick={handleAddNote}
          >
            <Image src="/plus.svg" alt="Add note" width={14} height={14} />
          </button>
        </div>
        {chapter.library.notes.length > 0 && (
          <div className="flex flex-col" {...noteReorder.containerProps()}>
            {chapter.library.notes.map((note, i) => (
              <Fragment key={note.id}>
                <DropLine active={noteReorder.activeGap === i} />
                <div
                  {...noteReorder.dragHandleProps(i)}
                  {...noteReorder.dropZoneProps(i)}
                  className="flex items-center gap-2 group px-2 py-1.5 rounded hover:bg-panel transition-colors cursor-pointer"
                  onClick={() => setNoteLightboxIndex(i)}
                >
                <svg className="w-3.5 h-3.5 text-subtle/50 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <span className="text-xs flex-1 truncate">
                  {note.title
                    ? <span className="text-text">{note.title}</span>
                    : <span className="text-subtle/35 italic">Untitled note</span>
                  }
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); onRemoveNote(chapter.id, note.id); }}
                  className="hidden group-hover:flex text-subtle hover:text-error transition-colors flex-shrink-0"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                </div>
              </Fragment>
            ))}
            <DropLine active={noteReorder.activeGap === chapter.library.notes.length} />
          </div>
        )}
      </div>

      {/* ── Links ── */}
      {linksVisible && (
      <div className="px-4 pb-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-label-m uppercase text-subtle">Links</p>
          <button
            className="opacity-40 hover:opacity-100 transition-opacity"
            onClick={() => setLinkModalOpen(true)}
          >
            <Image src="/plus.svg" alt="Add link" width={14} height={14} />
          </button>
        </div>
        {chapter.library.links.length > 0 && (
          <div className="flex flex-col">
            {chapter.library.links.map((link) => (
              <LinkListItem
                key={link.id}
                link={link}
                onRemove={() => onRemoveLink(chapter.id, link.id)}
              />
            ))}
          </div>
        )}
      </div>
      )}
      </>
      </div>

      {/* Comments layer — cross-slides in from the right over the Library
          (§3.7 / 5.3). Kept mounted on shareable chapters so it can slide both
          ways without a remount; `active` gates the read cursor so unread badges
          only clear once it's actually on screen (§6). */}
      {commentsAvailable && (
        <div
          className={`absolute inset-0 overflow-y-auto transition-[translate,opacity] duration-[400ms] ease-[cubic-bezier(0,0,0.2,1)] ${
            showComments ? "translate-x-0 opacity-100" : "translate-x-full opacity-0 pointer-events-none"
          }`}
          aria-hidden={!showComments}
        >
          <EditorComments
            chapterId={chapter.id}
            scenes={chapter.scenes}
            currentUserId={currentUserId ?? ""}
            onSceneClick={onSceneClick}
            active={showComments}
          />
        </div>
      )}
      </div>

      {/* ── Footer: chapter stats + Sharing mini-menu (bottom-right, §3.6) ── */}
      {shareable && chapter?.id && (
        <div
          className="flex-shrink-0 bg-bg"
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
          {/* Chapter word count — shown while "Show stats" is on (any chapter).
              Styled like the Book Info stat cards. */}
          {showChapterStats && (
            <div className="px-3 pt-3">
              <div className="rounded bg-panel px-5 py-4 flex items-center justify-between">
                <span className="text-body-m text-subtle">Words</span>
                <span className="font-serif text-[18px] leading-none text-text tabular-nums">
                  {chapterWordCount(chapter.scenes).toLocaleString()}
                </span>
              </div>
            </div>
          )}
          <div className="flex items-center justify-end px-3 py-2">
            <SharingMenu
              key={chapter.id}
              chapterId={chapter.id}
              chapterTitle={chapter.title}
              onDeleteChapter={(id) => onDeleteChapter?.(id)}
              showStats={showChapterStats}
              onToggleStats={() => onToggleChapterStats?.()}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Header glyphs ─────────────────────────────────────────────────────────────

function CommentsGlyph() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.5C21.0034 12.8199 20.6951 14.1219 20.1 15.3C19.3944 16.7118 18.3098 17.8992 16.9674 18.7293C15.6251 19.5594 14.0782 19.9994 12.5 20C11.1801 20.0035 9.87812 19.6951 8.7 19.1L3 21L4.9 15.3C4.30493 14.1219 3.99656 12.8199 4 11.5C4.00061 9.92179 4.44061 8.37488 5.27072 7.03258C6.10083 5.69028 7.28825 4.6056 8.7 3.90003C9.87812 3.30496 11.1801 2.99659 12.5 3.00003H13C15.0843 3.11502 17.053 3.99479 18.5291 5.47089C20.0052 6.94699 20.885 8.91568 21 11V11.5Z" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
