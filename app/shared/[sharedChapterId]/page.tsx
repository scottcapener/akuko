"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureDevSession } from "@/lib/ensureDevSession";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import { useColumnResize } from "@/lib/useColumnResize";
import { ReadComments } from "@/components/sharing/ReadComments";
import { refreshUnread } from "@/lib/useUnread";
import type { ReadView, BookPanelChapter } from "@/lib/shared/read";

// The read view (§3.3): one shared chapter as continuous prose, with a
// read-only Book Panel (the reader's accessible chapters of this book) and a
// comments column. A Read Header carries book identity + the × back to the feed.
// No editor Library — this is the draft, not the workspace.

// Loaded read views, cached at module scope so moving between a book's chapters
// is instant: after a chapter loads we prefetch its siblings into this map
// (Stage 10.1), and a revisit seeds from here before revalidating.
const readViewCache = new Map<string, ReadView>();

export default function SharedReadPage({
  params,
}: {
  params: Promise<{ sharedChapterId: string }>;
}) {
  const { sharedChapterId } = use(params);
  const router = useRouter();
  const [view, setView] = useState<ReadView | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "notfound">("loading");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Resizable left Book Panel, same mechanism as the writer's panels (Stage 10.3).
  // Gate the stored width behind mount so SSR (which can't read localStorage)
  // and hydration agree.
  const left = useColumnResize("hc.read.leftWidth", 280, 200, 440, 1);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const leftWidth = mounted ? left.width : 280;

  // Prose + comments rail share this scroll container so cards scroll with text.
  const scrollRef = useRef<HTMLDivElement>(null);
  const proseRef = useRef<HTMLDivElement>(null);
  // Bumped once the prose is in the DOM, so ReadComments (re)builds its maps.
  const [proseReady, setProseReady] = useState(0);
  useEffect(() => {
    if (view) setProseReady((n) => n + 1);
  }, [view]);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    // Seed from cache for an instant paint on sibling navigation; otherwise show
    // the loading skeleton. Either way we revalidate below.
    const cached = readViewCache.get(sharedChapterId);
    if (cached) { setView(cached); setStatus("ok"); }
    else { setView(null); setStatus("loading"); }

    (async () => {
      await ensureDevSession(supabase);
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        router.replace(`/login?next=/shared/${sharedChapterId}`);
        return;
      }
      setCurrentUserId(user.id);
      try {
        const res = await fetch(`/api/shared/${sharedChapterId}`);
        if (cancelled) return;
        if (res.status === 404) { setStatus("notfound"); return; }
        const data = (await res.json()) as ReadView;
        readViewCache.set(sharedChapterId, data);
        setView(data);
        setStatus("ok");
        // The view fetch marked this chapter seen server-side; refresh the
        // shared unread store so the account/nav badges reflect it (§6).
        refreshUnread();
        // Prefetch the reader's other chapters of this book so moving between
        // them is instant (Stage 10.1). Fire-and-forget; skip ones already cached.
        for (const ch of data.chapters) {
          if (ch.sharedChapterId === sharedChapterId || readViewCache.has(ch.sharedChapterId)) continue;
          fetch(`/api/shared/${ch.sharedChapterId}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (d) readViewCache.set(ch.sharedChapterId, d as ReadView); })
            .catch(() => {});
        }
      } catch {
        if (!cancelled && !cached) setStatus("notfound");
      }
    })();
    return () => { cancelled = true; };
  }, [sharedChapterId, router]);

  // Arrow-key chapter navigation (Stage 10.2) — keyboard only, no on-screen
  // arrows. Left/Right move to the previous/next accessible chapter in book
  // order. Ignored while typing (a comment composer, etc.).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const chapters = view?.chapters ?? [];
      const idx = chapters.findIndex((c) => c.current);
      if (idx < 0) return;
      const next = e.key === "ArrowLeft" ? chapters[idx - 1] : chapters[idx + 1];
      if (next) {
        e.preventDefault();
        router.push(`/shared/${next.sharedChapterId}`);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, router]);

  if (status === "notfound") {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-text text-lg font-medium">This chapter isn’t available</p>
        <p className="text-subtle text-sm max-w-sm">
          It may have been unshared, or you don’t have access. Ask the author to share it with you.
        </p>
        <button
          onClick={() => router.push("/shared")}
          className="mt-2 px-4 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:bg-accent-hi transition-colors"
        >
          Back to Shared with you
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-bg">
      <ReadHeader view={view} onExit={() => router.push("/shared")} />

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left — read-only Book Panel (desktop), resizable via the divider. */}
        <div
          className="hidden md:flex flex-shrink-0 overflow-hidden"
          style={{ width: leftWidth }}
        >
          {view && <BookPanel view={view} />}
        </div>
        <div
          onMouseDown={left.onMouseDown}
          className="hidden md:block relative z-10 w-px flex-shrink-0 bg-border-subtle hover:bg-accent/40 cursor-col-resize transition-colors active:bg-accent/60 before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-['']"
        />

        {/* Center + right share one scroll container so comment cards scroll
            with the prose they anchor to (§3.4). */}
        <div ref={scrollRef} className="flex-1 min-w-0 overflow-y-auto">
          <div className="flex min-h-full">
            {/* Prose */}
            <div ref={proseRef} className="flex-1 min-w-0">
              {status === "loading" || !view ? (
                <div className="max-w-[700px] mx-auto px-6 py-16 flex flex-col gap-3" aria-hidden>
                  {[...Array(8)].map((_, i) => (
                    <div key={i} className="h-4 rounded bg-panel animate-pulse" style={{ width: `${70 + (i % 3) * 10}%` }} />
                  ))}
                </div>
              ) : (
                <Prose view={view} />
              )}
            </div>

            {/* Comments rail (desktop). Its own header carries the Comments icon
                and collapse toggle now (Stage 6), so it's always mounted here. */}
            {view && currentUserId && (
              <div className="hidden md:block flex-shrink-0">
                <ReadComments
                  sharedChapterId={sharedChapterId}
                  currentUserId={currentUserId}
                  scrollRef={scrollRef}
                  proseRef={proseRef}
                  proseReady={proseReady}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Read Header ───────────────────────────────────────────────────────────────

function ReadHeader({
  view,
  onExit,
}: {
  view: ReadView | null;
  onExit: () => void;
}) {
  return (
    <header className="h-16 flex-shrink-0 border-b border-border-subtle flex items-center justify-between px-4 gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <span className="h-9 aspect-[2/3] flex-shrink-0 rounded overflow-hidden bg-panel border border-border-subtle flex items-center justify-center">
          {view?.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={view.coverUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <svg className="w-4 h-4 text-subtle opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.966 8.966 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          )}
        </span>
        {view && (
          <p className="text-sm truncate">
            <span className="text-text font-medium">{view.bookTitle || "Untitled book"}</span>
            <span className="text-subtle"> by {view.authorName}</span>
          </p>
        )}
      </div>

      {/* Just the exit control — the Comments toggle now lives at the top of the
          comments column (§3.3 / Stage 6), not in this header. */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onExit}
          aria-label="Close"
          title="Back to Shared with you"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-subtle hover:text-text hover:bg-hover transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </header>
  );
}

// ── Book Panel (read-only) ─────────────────────────────────────────────────────

function BookPanel({ view }: { view: ReadView }) {
  // Its OWN view-mode key — these are a flat, sectionless list in book order,
  // distinct from the editor's per-section hc.sectionViews (§3.3).
  const [mode, setMode] = useLocalStorageState<"list" | "grid">("hc.sharedBookView", "list");
  const chapters = view.chapters;

  return (
    <div className="flex flex-col h-full w-full">
      {/* Panel header — book-open icon, mirroring the writer's Book Panel and
          aligning with the other column headers (Stage 6). Book identity (cover,
          title, author) now lives only in the Read Header, so the Book Overview
          block is dropped here to avoid the duplication. */}
      <div className="h-16 flex-shrink-0 px-4 flex items-center">
        <svg className="w-5 h-5 text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.966 8.966 0 00-6 2.292m0-14.25v14.25" />
        </svg>
      </div>

      {/* Chapters header — label + list/grid toggle. Chapter navigation is
          keyboard-only now (←/→); the on-screen arrows were removed (Stage 10.2). */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <p className="text-label-m uppercase text-subtle">Chapters</p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMode((m) => (m === "list" ? "grid" : "list"))}
            aria-label={mode === "list" ? "Grid view" : "List view"}
            title={mode === "list" ? "Grid view" : "List view"}
            className="w-6 h-6 flex items-center justify-center rounded text-subtle hover:text-text hover:bg-hover transition-colors"
          >
            {mode === "list" ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v4H4zM14 15h6v4h-6z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Chapter list / grid */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        {mode === "list" ? (
          <div className="flex flex-col">
            {chapters.map((c) => (
              <ChapterRow key={c.sharedChapterId} chapter={c} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {chapters.map((c) => (
              <ChapterCell key={c.sharedChapterId} chapter={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChapterRow({ chapter }: { chapter: BookPanelChapter }) {
  return (
    <a
      href={`/shared/${chapter.sharedChapterId}`}
      className={`text-sm px-2 py-1.5 rounded truncate transition-colors ${
        chapter.current ? "bg-hover text-text" : "text-muted hover:text-text hover:bg-panel"
      }`}
    >
      {chapter.title}
    </a>
  );
}

function ChapterCell({ chapter }: { chapter: BookPanelChapter }) {
  // Mirrors the writer's grid cell (LeftColumn) so the two views read as one
  // system (Stage 10.5): square-ish tile, centered tiny label, current chapter
  // gets the elevated fill + accent border.
  return (
    <a
      href={`/shared/${chapter.sharedChapterId}`}
      title={chapter.title}
      className={`w-full aspect-[3/4] rounded text-[9px] font-medium text-center flex items-center justify-center px-1 leading-tight truncate transition-colors ${
        chapter.current
          ? "bg-elevated text-text border-[1.5px] border-accent"
          : "bg-panel text-subtle hover:bg-hover hover:text-text"
      }`}
    >
      <span className="truncate w-full text-center leading-tight">{chapter.title}</span>
    </a>
  );
}

// ── Prose ───────────────────────────────────────────────────────────────────

function Prose({ view }: { view: ReadView }) {
  return (
    <article className="max-w-[700px] mx-auto px-6 py-12 md:py-16">
      <h1 className="font-serif text-text text-2xl mb-8">{view.chapterTitle}</h1>
      <div className="font-serif text-manuscript-l text-text">
        {view.scenes.map((scene, i) => (
          <div key={scene.id} data-shared-scene-id={scene.id}>
            {i > 0 && (
              <div className="text-center text-subtle/50 select-none my-8" aria-hidden>
                * * *
              </div>
            )}
            {/* body_html is sanitized at snapshot time (lib/sanitize.ts). Scene
                labels are intentionally omitted — author metadata, not the draft.
                data-scene-body marks the anchoring root for comment offsets. */}
            <div
              data-scene-body
              className="indent-9 [&_p]:mb-0 [&_em]:italic [&_i]:italic [&_b]:font-bold [&_strong]:font-bold"
              dangerouslySetInnerHTML={{ __html: scene.bodyHtml }}
            />
          </div>
        ))}
        {view.scenes.length === 0 && (
          <p className="indent-0 text-subtle/70 not-italic">This chapter is empty.</p>
        )}
      </div>
    </article>
  );
}
