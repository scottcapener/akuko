"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureDevSession } from "@/lib/ensureDevSession";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import { Avatar } from "@/components/ui/Avatar";
import { ReadComments } from "@/components/sharing/ReadComments";
import { refreshUnread } from "@/lib/useUnread";
import type { ReadView, BookPanelChapter } from "@/lib/shared/read";

// The read view (§3.3): one shared chapter as continuous prose, with a
// read-only Book Panel (the reader's accessible chapters of this book) and a
// comments column (Stage 2 fills it). A Read Header carries book identity + the
// × back to the feed. No editor Library — this is the draft, not the workspace.

export default function SharedReadPage({
  params,
}: {
  params: Promise<{ sharedChapterId: string }>;
}) {
  const { sharedChapterId } = use(params);
  const router = useRouter();
  const [view, setView] = useState<ReadView | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "notfound">("loading");
  const [commentsOpen, setCommentsOpen] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

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
        const data = await res.json();
        setView(data as ReadView);
        setStatus("ok");
        // The view fetch marked this chapter seen server-side; refresh the
        // shared unread store so the account/nav badges reflect it (§6).
        refreshUnread();
      } catch {
        if (!cancelled) setStatus("notfound");
      }
    })();
    return () => { cancelled = true; };
  }, [sharedChapterId, router]);

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
      <ReadHeader
        view={view}
        commentsOpen={commentsOpen}
        onToggleComments={() => setCommentsOpen((v) => !v)}
        onExit={() => router.push("/shared")}
      />

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left — read-only Book Panel (desktop). */}
        <div className="hidden md:flex w-[280px] flex-shrink-0 border-r border-border-subtle">
          {view && <BookPanel view={view} />}
        </div>

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

            {/* Comments rail (desktop; toggled by the header icon). */}
            {commentsOpen && view && currentUserId && (
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
  commentsOpen,
  onToggleComments,
  onExit,
}: {
  view: ReadView | null;
  commentsOpen: boolean;
  onToggleComments: () => void;
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

      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onToggleComments}
          aria-pressed={commentsOpen}
          aria-label="Toggle comments"
          title="Comments"
          className={`hidden md:flex w-8 h-8 items-center justify-center rounded-lg transition-colors ${
            commentsOpen ? "text-text bg-hover" : "text-subtle hover:text-text hover:bg-hover"
          }`}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 12a8 8 0 01-11.6 7.1L4 20l1-4.4A8 8 0 1120 12z" />
          </svg>
        </button>
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
  const router = useRouter();
  // Its OWN view-mode key — these are a flat, sectionless list in book order,
  // distinct from the editor's per-section hc.sectionViews (§3.3).
  const [mode, setMode] = useLocalStorageState<"list" | "grid">("hc.sharedBookView", "list");
  const chapters = view.chapters;
  const currentIndex = chapters.findIndex((c) => c.current);

  function go(delta: number) {
    const next = chapters[currentIndex + delta];
    if (next) router.push(`/shared/${next.sharedChapterId}`);
  }

  return (
    <div className="flex flex-col h-full w-full">
      {/* Cover + book identity */}
      <div className="px-4 pt-5 pb-4 flex flex-col items-center text-center gap-2 border-b border-border-subtle">
        <span className="w-20 aspect-[2/3] rounded-md overflow-hidden bg-panel border border-border-subtle flex items-center justify-center">
          {view.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={view.coverUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <svg className="w-6 h-6 text-subtle opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.966 8.966 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          )}
        </span>
        <div className="min-w-0">
          <p className="text-text text-sm font-medium truncate">{view.bookTitle || "Untitled book"}</p>
          <div className="flex items-center justify-center gap-1.5 mt-1">
            <Avatar name={view.authorName} src={view.authorAvatarUrl} size={16} />
            <span className="text-subtle text-xs truncate">{view.authorName}</span>
          </div>
        </div>
      </div>

      {/* Chapters header — label, prev/next, list/grid toggle */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <p className="text-label-m uppercase text-subtle">Chapters</p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => go(-1)}
            disabled={currentIndex <= 0}
            aria-label="Previous chapter"
            className="w-6 h-6 flex items-center justify-center rounded text-subtle hover:text-text hover:bg-hover disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={() => go(1)}
            disabled={currentIndex < 0 || currentIndex >= chapters.length - 1}
            aria-label="Next chapter"
            className="w-6 h-6 flex items-center justify-center rounded text-subtle hover:text-text hover:bg-hover disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
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
          <div className="grid grid-cols-2 gap-2">
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
  return (
    <a
      href={`/shared/${chapter.sharedChapterId}`}
      className={`aspect-[3/4] rounded-md border p-2 flex items-end text-xs transition-colors ${
        chapter.current
          ? "border-accent/60 bg-hover text-text"
          : "border-border-subtle bg-panel text-muted hover:text-text"
      }`}
    >
      <span className="line-clamp-2">{chapter.title}</span>
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
