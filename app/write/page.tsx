"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useHotCocoaDb } from "@/lib/useHotCocoaDb";
import LeftColumn from "@/components/LeftColumn";
import CenterColumn from "@/components/CenterColumn";
import RightColumn from "@/components/RightColumn";
import { ConflictModal } from "@/components/ConflictModal";
import { SceneDragProvider } from "@/lib/useSceneDrag";
import { ChapterDragProvider } from "@/lib/useChapterDrag";
import { Scene } from "@/lib/types";

type MobilePanel = "left" | "right" | null;

const LEFT_MIN = 160;
const LEFT_MAX = 360;
const RIGHT_MIN = 160;
const RIGHT_MAX = 400;
const LEFT_DEFAULT = 208;
const RIGHT_DEFAULT = 240;
const COLLAPSED_WIDTH = 56;

// Side-by-side splits the editor area by fraction rather than pixels, so the two
// panes keep their proportions when the Book panel collapses or the window resizes.
const SPLIT_MIN = 0.25;
const SPLIT_MAX = 0.75;
const SPLIT_DEFAULT = 0.5;

function useColumnResize(storageKey: string, defaultPx: number, min: number, max: number, direction: 1 | -1 = 1) {
  // Lazily restore the last-used width. Safe against hydration mismatch: the write
  // page renders a blank placeholder until `store.hydrated`, so this width never
  // reaches the DOM during the initial server/client render.
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return defaultPx;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw != null) {
        const n = parseInt(raw, 10);
        if (!Number.isNaN(n)) return Math.min(max, Math.max(min, n));
      }
    } catch {}
    return defaultPx;
  });
  // `resizing` is state (not just the `dragging` ref) so the column wrapper can
  // drop its width transition mid-drag — otherwise the collapse/expand easing
  // would also apply to resize, making the edge lag behind the cursor.
  const [resizing, setResizing] = useState(false);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);
  // Mirrors `width` so the drag-end handler can persist the final value without
  // re-registering the window listeners on every mousemove.
  const widthRef = useRef(width);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    setResizing(true);
    startX.current = e.clientX;
    startW.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragging.current) return;
      const delta = (e.clientX - startX.current) * direction;
      const next = Math.min(max, Math.max(min, startW.current + delta));
      widthRef.current = next;
      setWidth(next);
    }
    function onMouseUp() {
      if (!dragging.current) return;
      dragging.current = false;
      setResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Persist only on drag-end, not on every frame.
      try { localStorage.setItem(storageKey, String(widthRef.current)); } catch {}
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [min, max, direction, storageKey]);

  return { width, onMouseDown, resizing };
}

// The divider between the two Chapter Editors. Mirrors `useColumnResize`'s drag
// contract (state-backed `resizing`, persist on drag-end only) but tracks a
// fraction of the editor area's width, captured once at drag start.
function useSplitResize(storageKey: string, containerRef: React.RefObject<HTMLDivElement | null>) {
  const [fraction, setFraction] = useState<number>(() => {
    if (typeof window === "undefined") return SPLIT_DEFAULT;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw != null) {
        const n = parseFloat(raw);
        if (!Number.isNaN(n)) return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, n));
      }
    } catch {}
    return SPLIT_DEFAULT;
  });
  const [resizing, setResizing] = useState(false);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startFraction = useRef(0);
  const containerWidth = useRef(0);
  const fractionRef = useRef(fraction);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const w = containerRef.current?.getBoundingClientRect().width ?? 0;
    if (!w) return;
    dragging.current = true;
    setResizing(true);
    startX.current = e.clientX;
    startFraction.current = fraction;
    containerWidth.current = w;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [fraction, containerRef]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragging.current) return;
      const delta = (e.clientX - startX.current) / containerWidth.current;
      const next = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, startFraction.current + delta));
      fractionRef.current = next;
      setFraction(next);
    }
    function onMouseUp() {
      if (!dragging.current) return;
      dragging.current = false;
      setResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try { localStorage.setItem(storageKey, String(fractionRef.current)); } catch {}
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [storageKey]);

  return { fraction, onMouseDown, resizing };
}

// User-level view preferences (grid/list per section, scene visibility). These are
// display-only and never touch book structure, so they live in localStorage rather
// than the DB. Reads happen after mount to avoid a hydration mismatch.
function useLocalStorageState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const loaded = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) setValue(JSON.parse(raw) as T);
    } catch {}
    loaded.current = true;
  }, [key]);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);
  return [value, setValue] as const;
}

// Panel collapse width + the panel body's own fade run concurrently off the same
// boolean (see LeftColumn/RightColumn: the body renders at a fixed pixel width
// so it never visibly resizes — this wrapper's `overflow-hidden` just reveals or
// hides more of it as the width tweens, while the body's opacity fades in step).
const COLLAPSE_DURATION_MS = 200;

// Entering/leaving side-by-side runs as three ordered steps rather than one
// blended move: the outgoing surface fades out, the divider travels, then the
// incoming surface fades in. Slower than the panel collapse on purpose — it
// restructures most of the window, so the eye needs longer to follow it.
const SBS_FADE_MS = 200;
const SBS_MOVE_MS = 400;
const SBS_TOTAL_MS = SBS_FADE_MS * 2 + SBS_MOVE_MS;

export default function WritePage() {
  const router = useRouter();
  const store = useHotCocoaDb();
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const left = useColumnResize("hc.leftWidth", LEFT_DEFAULT, LEFT_MIN, LEFT_MAX, 1);
  const right = useColumnResize("hc.rightWidth", RIGHT_DEFAULT, RIGHT_MIN, RIGHT_MAX, -1);

  const [scenesVisible, setScenesVisible] = useLocalStorageState("hc.scenesVisible", true);
  const [linksVisible, setLinksVisible] = useLocalStorageState("hc.linksVisible", true);
  const [leftCollapsed, setLeftCollapsed] = useLocalStorageState("hc.leftCollapsed", false);
  const [rightCollapsed, setRightCollapsed] = useLocalStorageState("hc.rightCollapsed", false);
  const [sectionViews, setSectionViews] = useLocalStorageState<Record<string, "grid" | "list">>("hc.sectionViews", {});
  const setSectionView = useCallback((sectionId: string, view: "grid" | "list") => {
    setSectionViews((prev) => ({ ...prev, [sectionId]: view }));
  }, [setSectionViews]);

  // ── Side-by-side ──────────────────────────────────────────────────────────
  // Pane 1's chapter is the book's own activeChapterId (persisted server-side, so
  // it stays the "last edited chapter" everywhere else). Pane 2 is a local view
  // preference, so it lives in localStorage alongside the panel widths.
  const [secondaryChapterId, setSecondaryChapterId] = useLocalStorageState<string | null>("hc.sbs.chapterId", null);
  const [focusedPane, setFocusedPane] = useLocalStorageState<1 | 2>("hc.sbs.focusedPane", 1);
  const editorAreaRef = useRef<HTMLDivElement>(null);
  const split = useSplitResize("hc.sbs.split", editorAreaRef);

  const activeChapterId = store.activeChapter?.id;
  const chapterIds = useMemo(
    () => new Set(store.sections.flatMap((s) => s.chapters.map((c) => c.id))),
    [store.sections]
  );

  // Close pane 2 when its chapter is no longer valid: deleted outright, removed
  // with its section, or collided with pane 1 (deleting pane 1's chapter makes
  // the store fall back to a neighbour, which may be pane 2's).
  useEffect(() => {
    if (!store.hydrated || secondaryChapterId == null) return;
    if (!chapterIds.has(secondaryChapterId) || secondaryChapterId === activeChapterId) {
      setSecondaryChapterId(null);
      setFocusedPane(1);
    }
  }, [store.hydrated, secondaryChapterId, chapterIds, activeChapterId, setSecondaryChapterId, setFocusedPane]);

  // Pane 2 fetches its own content. Gated on `hydrated` because bootstrap is what
  // establishes the Supabase session — firing earlier (which a pane restored from
  // localStorage does) means the fetch runs unauthenticated and comes back empty.
  const loadChapter = store.loadChapter;
  useEffect(() => {
    if (store.hydrated && secondaryChapterId) loadChapter(secondaryChapterId);
  }, [store.hydrated, secondaryChapterId, loadChapter]);

  // ── Scene navigation ────────────────────────────────────────────────────────
  // Clicking a scene in the Book Panel (list view) reveals it in the Chapter
  // Editor. The nonce bumps every click so re-clicking the same scene re-fires
  // the reveal; the target is broadcast to every Chapter Editor and each self-
  // guards by scene id (see CenterColumn).
  const sceneScrollNonce = useRef(0);
  const [sceneScrollTarget, setSceneScrollTarget] = useState<{ sceneId: string; nonce: number } | null>(null);
  const handleSceneClick = useCallback((chapterId: string, sceneId: string) => {
    // In side-by-side, focus the pane that holds the clicked scene's chapter so
    // the reveal lands in the pane the user is looking at.
    if (secondaryChapterId != null) {
      if (chapterId === secondaryChapterId) setFocusedPane(2);
      else if (chapterId === activeChapterId) setFocusedPane(1);
    }
    sceneScrollNonce.current += 1;
    setSceneScrollTarget({ sceneId, nonce: sceneScrollNonce.current });
  }, [secondaryChapterId, activeChapterId, setFocusedPane]);

  const setActiveChapter = store.setActiveChapter;
  const handleChapterClick = useCallback((id: string) => {
    if (secondaryChapterId == null) { setActiveChapter(id); return; }
    // The two editors can never show the same chapter, so clicking one that's
    // already open just moves focus to whichever pane holds it.
    if (id === activeChapterId) { setFocusedPane(1); return; }
    if (id === secondaryChapterId) { setFocusedPane(2); return; }
    if (focusedPane === 2) setSecondaryChapterId(id);
    else setActiveChapter(id);
  }, [secondaryChapterId, activeChapterId, focusedPane, setActiveChapter, setSecondaryChapterId, setFocusedPane]);

  // ── Enter/exit animation ──────────────────────────────────────────────────
  // Entering and leaving side-by-side is a cross-fade in place: the split divider
  // starts life exactly where the Library's border was and slides to the split
  // position, while the Library fades out over the incoming second pane (and the
  // reverse on close). During either phase the Library is lifted out of flow —
  // which is what widens the editor area — but it keeps its slot in the tree so
  // it is never remounted mid-fade.
  const [sbsTransition, setSbsTransition] = useState<
    { phase: "opening" | "closing"; footprint: number; from: number; to: number } | null
  >(null);
  // "idle" is the pre-flight frame that paints the starting geometry so the
  // browser has something to interpolate from; the rest are the three steps.
  const [stage, setStage] = useState<"idle" | "fadeOut" | "move" | "fadeIn">("idle");

  // Width the Library occupies today, including its resize divider (which isn't
  // rendered while collapsed). This is the distance the split divider travels.
  const libraryFootprint = rightCollapsed ? COLLAPSED_WIDTH : right.width + 1;

  useEffect(() => {
    if (!sbsTransition) return;
    // Paint once at the starting geometry before flipping to the target, so the
    // browser has two distinct values to interpolate between.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setStage("fadeOut"));
    });
    const toMove = setTimeout(() => setStage("move"), SBS_FADE_MS);
    const toFadeIn = setTimeout(() => setStage("fadeIn"), SBS_FADE_MS + SBS_MOVE_MS);
    const done = setTimeout(() => {
      // Closing defers dropping the chapter until here, so pane 2 stays mounted
      // for the whole sequence.
      if (sbsTransition.phase === "closing") {
        setSecondaryChapterId(null);
        setFocusedPane(1);
      }
      setSbsTransition(null);
      setStage("idle");
    }, SBS_TOTAL_MS);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(toMove);
      clearTimeout(toFadeIn);
      clearTimeout(done);
    };
  }, [sbsTransition, setSecondaryChapterId, setFocusedPane]);

  const splitFraction = split.fraction;
  const openSideBySide = useCallback((chapterId: string) => {
    const swapping = secondaryChapterId != null;
    setSecondaryChapterId(chapterId);
    setFocusedPane(2);
    // Re-targeting pane 2 while already open (or interrupting a close) is a
    // content swap, not a geometry change — cancel any in-flight close so its
    // timer can't tear down the pane we just populated.
    if (swapping || sbsTransition) {
      setSbsTransition(null);
      setStage("idle");
      return;
    }
    const editorWidth = editorAreaRef.current?.getBoundingClientRect().width ?? 0;
    if (!editorWidth) return;
    setStage("idle");
    setSbsTransition({
      phase: "opening",
      footprint: libraryFootprint,
      // Pane 1 starts owning everything left of the Library border, so the split
      // divider is born exactly where the Library divider sat.
      from: editorWidth,
      to: splitFraction * (editorWidth + libraryFootprint),
    });
  }, [secondaryChapterId, sbsTransition, libraryFootprint, splitFraction, setSecondaryChapterId, setFocusedPane]);

  const closeSideBySide = useCallback(() => {
    const editorWidth = editorAreaRef.current?.getBoundingClientRect().width ?? 0;
    if (!editorWidth) {
      setSecondaryChapterId(null);
      setFocusedPane(1);
      return;
    }
    setStage("idle");
    setSbsTransition({
      phase: "closing",
      footprint: libraryFootprint,
      from: splitFraction * editorWidth,
      to: editorWidth - libraryFootprint,
    });
  }, [libraryFootprint, splitFraction, setSecondaryChapterId, setFocusedPane]);

  // Stable refs so the paste listener never goes stale
  const activeChapterRef = useRef(store.activeChapter);
  activeChapterRef.current = store.activeChapter;
  const addLibraryImageRef = useRef(store.addLibraryImage);
  addLibraryImageRef.current = store.addLibraryImage;

  // Route guard: unauthenticated users go to /login. Users with a session but no
  // finished profile (e.g. they confirmed their email but never completed the
  // signup wizard) go back to /signup, which resumes at the profile step.
  // Skipped in development when NEXT_PUBLIC_DEV_USER_ID is set.
  useEffect(() => {
    if (process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DEV_USER_ID) return;
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.replace("/login"); return; }
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle();
      // Only bounce to /signup when the fetch *succeeded* and the profile is
      // genuinely unfinished. A transient/errored fetch must NOT be read as
      // "incomplete" — doing so traps finished users in the signup wizard.
      if (!error && !profile?.display_name) router.replace("/signup");
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global image paste — fires when focus is outside a text/contenteditable field
  // (when focus IS in a scene body, CenterColumn's own onPaste handler adds the image)
  useEffect(() => {
    function handleGlobalPaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement;
      // CenterColumn has its own onPaste that adds the image for any paste within it.
      // Skip here so the image isn't added twice — the tag checks below miss focusable
      // non-editable targets inside CenterColumn (e.g. a focused button), which slipped
      // through and caused a double-add.
      if (target.closest?.('[data-paste-scope="center"]')) return;
      if (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((it) => it.type.startsWith("image/"));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file || !activeChapterRef.current) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        addLibraryImageRef.current(activeChapterRef.current!.id, {
          id: Math.random().toString(36).slice(2, 10),
          name: `pasted-${Date.now()}.png`,
          dataUrl: ev.target?.result as string,
        });
      };
      reader.readAsDataURL(file);
    }
    document.addEventListener("paste", handleGlobalPaste);
    return () => document.removeEventListener("paste", handleGlobalPaste);
  }, []);

  useEffect(() => {
    const name = store.book?.title?.trim();
    document.title = name ? `${name} on Hot Cocoa` : "Hot Cocoa";
  }, [store.book?.title]);

  if (!store.hydrated || !store.book || !store.activeChapter) {
    return <div className="h-full bg-bg" />;
  }

  function openPanel(p: MobilePanel) {
    setMobilePanel((prev) => (prev === p ? null : p));
  }

  // Resolved only after hydration, so the reconcile effect above has had a chance
  // to drop a stale id. Side-by-side is desktop-only and hides the Library.
  const secondaryChapter =
    (secondaryChapterId && store.sections.flatMap((s) => s.chapters).find((c) => c.id === secondaryChapterId)) || null;
  const sideBySide = secondaryChapter != null;

  // While a transition runs the Library is still rendered (floating, fading) even
  // though side-by-side is logically on; and on close pane 2 outlives the state
  // change by one animation.
  const transitioning = sbsTransition != null;
  const libraryPresent = !sideBySide || transitioning;
  const fade = `opacity ${SBS_FADE_MS}ms ease-in-out`;

  // Step 1 hides whatever is leaving, step 3 reveals whatever is arriving; in
  // between only the divider moves, across an empty gap. Opening retires the
  // Library and brings in pane 2; closing is the mirror image.
  const opening = sbsTransition?.phase === "opening";
  const outgoingOpacity = stage === "idle" ? 1 : 0;
  const incomingOpacity = stage === "fadeIn" ? 1 : 0;
  const libraryOpacity = !transitioning ? 1 : opening ? outgoingOpacity : incomingOpacity;
  const paneTwoOpacity = !transitioning ? 1 : opening ? incomingOpacity : outgoingOpacity;

  const paneOneStyle: React.CSSProperties = sbsTransition
    ? {
        // Holds the starting width through step 1, travels during steps 2–3.
        width: stage === "idle" || stage === "fadeOut" ? sbsTransition.from : sbsTransition.to,
        flexShrink: 0,
        transition: `width ${SBS_MOVE_MS}ms ease-in-out`,
      }
    : sideBySide
    ? { width: `${split.fraction * 100}%`, flexShrink: 0 }
    : { flex: 1 };

  const leftProps = {
    book: store.book,
    sections: store.sections,
    activeChapter: store.activeChapter,
    onBookTitleChange: store.setBookTitle,
    onCoverImage: store.setCoverImage,
    onRefreshCover: store.refreshCoverUrl,
    onReorderChapters: store.reorderChapters,
    onMoveScene: store.moveScene,
    onMoveChapter: store.moveChapter,
    onDuplicateChapter: store.duplicateChapter,
    onDeleteChapter: store.deleteChapter,
    onAddSection: store.addSection,
    onUpdateSectionLabel: store.updateSectionLabel,
    onReorderSections: store.reorderSections,
    onDeleteSection: store.deleteSection,
    scenesVisible,
    onToggleScenes: () => setScenesVisible((v) => !v),
    linksVisible,
    onToggleLinks: () => setLinksVisible((v) => !v),
    sectionViews,
    onSetSectionView: setSectionView,
  };

  // Everything a Chapter Editor needs except the chapter itself, so the three
  // render sites (two desktop panes + mobile) don't restate it.
  const centerProps = {
    saveStatus: store.saveStatus,
    onChapterTitleChange: store.updateChapterTitle,
    onSceneChange: (chapterId: string, sceneId: string, patch: Partial<Scene>) =>
      store.updateScene(chapterId, sceneId, patch),
    onAddScene: store.addScene,
    onInsertScene: store.insertScene,
    onSplitChapter: store.splitChapter,
    onReorderScenes: store.reorderScenes,
    onDeleteScene: store.deleteScene,
    onAddImage: store.addLibraryImage,
    scenesVisible,
    scrollToScene: sceneScrollTarget,
  };

  const rightProps = {
    chapter: store.activeChapter,
    loading: !store.activeChapterLoaded,
    onAddImage: store.addLibraryImage,
    onRemoveImage: store.removeLibraryImage,
    onRefreshImage: store.refreshLibraryImageUrl,
    onAddNote: store.addNote,
    onUpdateNote: store.updateNote,
    onRemoveNote: store.removeNote,
    onAddMusicLink: store.addMusicLink,
    onRemoveMusicLink: store.removeMusicLink,
    onAddLink: store.addLink,
    onRemoveLink: store.removeLink,
    linksVisible,
    onReorderImages: store.reorderLibraryImages,
    onReorderMusicLinks: store.reorderMusicLinks,
    onReorderNotes: store.reorderNotes,
  };

  return (
    <SceneDragProvider>
    <ChapterDragProvider>
    <div className="h-full flex flex-col bg-bg overflow-hidden">
      {/* ── Mobile top bar ── */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border-subtle flex-shrink-0">
        <button
          onClick={() => openPanel("left")}
          className={`p-1.5 rounded transition-opacity ${mobilePanel === "left" ? "opacity-100" : "opacity-50 hover:opacity-80"}`}
        >
          <svg className="w-7 h-7 text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.966 8.966 0 00-6 2.292m0-14.25v14.25" />
          </svg>
        </button>
        <Image src="/logo-S.svg" alt="Hot Cocoa" width={105} height={20} style={{ filter: 'brightness(0) invert(1)' }} />
        <button
          onClick={() => openPanel("right")}
          className={`p-1.5 rounded transition-opacity ${mobilePanel === "right" ? "opacity-100" : "opacity-50 hover:opacity-80"}`}
        >
          <Image src="/library.svg" alt="Library" width={28} height={28} />
        </button>
      </header>

      {/* ── Desktop layout ── */}
      <div className="flex-1 hidden md:flex overflow-hidden relative">
        <div
          className="flex-shrink-0 flex flex-col overflow-hidden"
          style={{
            width: leftCollapsed ? COLLAPSED_WIDTH : left.width,
            transition: left.resizing ? "none" : `width ${COLLAPSE_DURATION_MS}ms ease-in-out`,
          }}
        >
          <LeftColumn
            {...leftProps}
            onChapterClick={handleChapterClick}
            onSceneClick={handleSceneClick}
            onAddChapter={store.addChapter}
            secondaryChapterId={secondaryChapterId}
            focusedPane={focusedPane}
            onOpenSideBySide={openSideBySide}
            collapsed={leftCollapsed}
            onToggleCollapse={() => setLeftCollapsed((v) => !v)}
            expandedWidth={left.width}
          />
        </div>
        {!leftCollapsed && (
          <div onMouseDown={left.onMouseDown} className="relative z-10 w-px flex-shrink-0 bg-border-subtle hover:bg-accent/40 cursor-col-resize transition-colors active:bg-accent/60 before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-['']" />
        )}
        {/* Editor area — one Chapter Editor normally, two in side-by-side. The two
            panes split this box by fraction, so the divider stays put when the
            Book panel collapses. */}
        <div ref={editorAreaRef} className="flex-1 overflow-hidden flex min-w-0">
          <div className="overflow-hidden flex flex-col min-w-0" style={paneOneStyle}>
            <CenterColumn
              {...centerProps}
              chapter={store.activeChapter}
              loading={!store.activeChapterLoaded}
              focused={sideBySide ? focusedPane === 1 : undefined}
              onFocusPane={sideBySide ? () => setFocusedPane(1) : undefined}
            />
          </div>
          {sideBySide && secondaryChapter && (
            <>
              <div onMouseDown={split.onMouseDown} className="relative z-10 w-px flex-shrink-0 bg-border-subtle hover:bg-accent/40 cursor-col-resize transition-colors active:bg-accent/60 before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-['']" />
              <div
                className="flex-1 overflow-hidden flex flex-col min-w-0"
                style={{ opacity: paneTwoOpacity, transition: transitioning ? fade : undefined }}
              >
                <CenterColumn
                  {...centerProps}
                  chapter={secondaryChapter}
                  loading={!store.isChapterLoaded(secondaryChapter.id)}
                  focused={focusedPane === 2}
                  onFocusPane={() => setFocusedPane(2)}
                  onClose={closeSideBySide}
                />
              </div>
            </>
          )}
        </div>
        {/* Library — hidden in side-by-side. Its collapsed/width state is untouched,
            so leaving side-by-side restores it as the user left it. Mid-transition
            it lifts out of flow (which is what widens the editor area) and fades,
            but stays in this same slot so React never remounts it — a remount would
            reset the image thumbnails' load state and flash mid-fade. */}
        {libraryPresent && (
          <div
            className={
              transitioning
                ? "absolute inset-y-0 right-0 z-20 flex pointer-events-none"
                : "flex flex-shrink-0"
            }
            style={
              transitioning
                ? { width: sbsTransition.footprint, opacity: libraryOpacity, transition: fade }
                : undefined
            }
          >
            {!rightCollapsed && (
              <div onMouseDown={right.onMouseDown} className="relative z-10 w-px flex-shrink-0 bg-border-subtle hover:bg-accent/40 cursor-col-resize transition-colors active:bg-accent/60 before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-['']" />
            )}
            <div
              className="flex-shrink-0 flex flex-col overflow-hidden"
              style={{
                width: rightCollapsed ? COLLAPSED_WIDTH : right.width,
                transition: right.resizing ? "none" : `width ${COLLAPSE_DURATION_MS}ms ease-in-out`,
              }}
            >
              <RightColumn
                {...rightProps}
                collapsed={rightCollapsed}
                onToggleCollapse={() => setRightCollapsed((v) => !v)}
                expandedWidth={right.width}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Mobile single-column ── */}
      {/* Side-by-side is desktop-only, so mobile always shows pane 1's chapter.
          The mode isn't torn down — widening the window restores both panes. */}
      <div className="flex-1 md:hidden overflow-hidden flex flex-col">
        <CenterColumn
          {...centerProps}
          chapter={store.activeChapter}
          loading={!store.activeChapterLoaded}
        />
      </div>

      {/* ── Mobile slide-in panels (full-width, per CocoaBar) ── */}
      {mobilePanel && (
        <div className="md:hidden fixed inset-0 bg-scrim z-30" onClick={() => setMobilePanel(null)} />
      )}
      <div className={`md:hidden fixed inset-y-0 left-0 z-40 w-full transition-transform duration-200 ${mobilePanel === "left" ? "translate-x-0" : "-translate-x-full"}`}>
        <LeftColumn
          {...leftProps}
          onChapterClick={(id) => { store.setActiveChapter(id); setMobilePanel(null); }}
          onSceneClick={(chapterId, sceneId) => { handleSceneClick(chapterId, sceneId); setMobilePanel(null); }}
          onAddChapter={(sectionId) => { store.addChapter(sectionId); setMobilePanel(null); }}
          onDeleteChapter={store.deleteChapter}
          onClose={() => setMobilePanel(null)}
        />
      </div>
      <div className={`md:hidden fixed inset-y-0 right-0 z-40 w-full transition-transform duration-200 ${mobilePanel === "right" ? "translate-x-0" : "translate-x-full"}`}>
        <RightColumn {...rightProps} onClose={() => setMobilePanel(null)} />
      </div>
      {store.conflicts.length > 0 && (
        <ConflictModal conflicts={store.conflicts} onResolve={store.resolveConflict} />
      )}
    </div>
    </ChapterDragProvider>
    </SceneDragProvider>
  );
}
