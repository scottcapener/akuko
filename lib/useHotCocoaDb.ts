"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "./supabase/client";
import { ensureDevSession } from "./ensureDevSession";
import * as db from "./db";
import * as offlineQueue from "./offlineQueue";
import * as offlineCache from "./offlineCache";
import * as offlineDb from "./offlineDb";
import { Book, Section, Chapter, Scene, LibraryImage, LibraryNote, LibraryMusicLink, LibraryLink } from "./types";
import { wordCountAll } from "./words";

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "offline";

// Autosave is debounced: a burst of typing collapses into one write DELAY ms
// after the last keystroke. MAX_WAIT caps how long unsaved edits can sit while
// someone types continuously (pure debounce would never fire mid-stream), so
// the unsaved window stays small even without a pause. DELAY rides through
// normal in-sentence hesitation and fires on a genuine "moved on" pause; every
// keystroke is still mirrored to IndexedDB, so the wider window risks no work.
const AUTOSAVE_DELAY = 5_000;
const AUTOSAVE_MAX_WAIT = 30_000;

// Don't flash "Saving…" for a write that finishes quickly — a fast save on a
// good connection would otherwise blink the status on every typing pause. Only
// surface the indicator once a write has been in flight this long, so it shows
// only when a save is genuinely slow (a laggy connection) and stays out of the
// way otherwise.
const SAVE_INDICATOR_DELAY = 450;


// Build a non-colliding "… Copy" title for a duplicated chapter: "X Copy", then
// "X Copy 2", "X Copy 3", … skipping any that already exist among `existing`.
function uniqueCopyTitle(base: string, existing: string[]): string {
  const taken = new Set(existing);
  const first = `${base} Copy`;
  if (!taken.has(first)) return first;
  let n = 2;
  while (taken.has(`${base} Copy ${n}`)) n++;
  return `${base} Copy ${n}`;
}

// Helper: update a single chapter anywhere in sections
function mapChapter(sections: Section[], chapterId: string, fn: (c: Chapter) => Chapter): Section[] {
  return sections.map((s) => ({
    ...s,
    chapters: s.chapters.map((c) => (c.id === chapterId ? fn(c) : c)),
  }));
}

// Background-download and cache the blobs behind stored images (library or cover)
// so they render offline later. Skips already-cached and external-URL images;
// fully best-effort, sequential to avoid a burst of downloads.
async function cacheImageBlobs(userId: string, paths: (string | undefined)[]) {
  for (const path of paths) {
    if (!path || (await offlineCache.hasImageBlob(path))) continue;
    const blob = await db.downloadStorageBlob(path);
    if (blob) await offlineCache.putImageBlob(userId, path, blob);
  }
}

export function useHotCocoaDb() {
  const [userId, setUserId] = useState<string | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [hydrated, setHydrated] = useState(false);
  const [unlocks, setUnlocks] = useState<number[]>([]);
  // The hidden "info chapter" backing Book Info (Synopsis scene + Book-Info
  // Library). Kept out of `sections` so it never touches word counts, the Book
  // Panel, side-by-side, exports, or backups; scene/library edits targeting it
  // are routed here by updateChapterState below.
  const [infoChapter, setInfoChapter] = useState<Chapter | null>(null);
  const [bookStats, setBookStats] = useState<db.BookStats | null>(null);

  const pendingSaves = useRef<Map<string, Partial<Scene>>>(new Map());
  // Last-write-wins token per dirty scene — the client's edit-time timestamp, sent
  // with the save (migration 021 / db.saveScene). Overwritten on every keystroke
  // so the flush stamps the batch with when the author *last* edited it; a rejected
  // save keeps its stamp so the retry re-sends the same value (idempotent). This
  // replaced the optimistic-concurrency base that used to drift stale and pop false
  // conflict modals — see CONFLICT_SUNSET.md.
  const pendingAuthoredAt = useRef<Map<string, string>>(new Map());
  const pendingNoteSaves = useRef<Map<string, { title?: string; body?: string }>>(new Map());
  const noteTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Deferred "Saving…" indicator (see SAVE_INDICATOR_DELAY): the timer fires only
  // if a write is still in flight after the delay, and `savingShown` records
  // whether it did so the flush can decide whether to bother showing "Saved".
  const saveIndicatorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingShown = useRef(false);
  // Timestamp of the oldest unsaved edit in the current pending batch, so the
  // debounce can be capped at AUTOSAVE_MAX_WAIT from the first edit.
  const firstPendingAt = useRef<number | null>(null);
  // Single-flight guard: a flush racing with a recovery-triggered flush could
  // re-queue a scene mid-save with a stale base and pop a spurious self-conflict.
  // Only one flush runs at a time; a flush requested while one is in flight sets
  // `flushAgain` and is re-run once the current one finishes.
  const isFlushing = useRef(false);
  const flushAgain = useRef(false);
  const initialized = useRef(false);
  const loadedChapterIds = useRef(new Set<string>());
  // State mirror of loadedChapterIds so the UI can render a skeleton until a
  // chapter's content has arrived. The ref stays the source of truth for dedup.
  const [loadedChapters, setLoadedChapters] = useState<Set<string>>(new Set());
  const prefetchStarted = useRef(false);

  // Refs mirror the latest state so async callbacks (flush, recovery) can read the
  // current scenes without re-subscribing on every keystroke.
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const bookRef = useRef(book);
  bookRef.current = book;
  const infoChapterRef = useRef(infoChapter);
  infoChapterRef.current = infoChapter;

  // Route a chapter-state update to the right container: the hidden info chapter
  // lives outside `sections`, so scene/library edits targeting it update
  // `infoChapter`; everything else maps within `sections` exactly as before.
  const updateChapterState = useCallback(
    (chapterId: string, fn: (c: Chapter) => Chapter) => {
      if (infoChapterRef.current && chapterId === infoChapterRef.current.id) {
        setInfoChapter((c) => (c ? fn(c) : c));
      } else {
        setSections((prev) => mapChapter(prev, chapterId, fn));
      }
    },
    []
  );

  // Find a chapter by id across both containers (sections + the info chapter),
  // so library/scene helpers that read current positions/paths also work for
  // Book Info. Reads refs, so callers needn't depend on `sections`.
  const findChapter = useCallback(
    (chapterId: string): Chapter | undefined =>
      infoChapterRef.current && infoChapterRef.current.id === chapterId
        ? infoChapterRef.current
        : sectionsRef.current.flatMap((s) => s.chapters).find((c) => c.id === chapterId),
    []
  );

  // ── Bootstrap ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Mark storage persistent so queued offline edits + the cache survive
    // storage pressure (esp. iOS eviction). Best-effort, fire-and-forget.
    offlineDb.requestPersistentStorage();

    const supabase = createClient();

    // Reconstruct the whole editor from the read cache when there's no network.
    async function hydrateFromCache() {
      const snap = await offlineCache.readSnapshot();
      if (!snap) {
        // Nothing cached and no network — mark hydrated so the UI can show its
        // empty state instead of hanging on a skeleton forever.
        setHydrated(true);
        return;
      }
      setUserId(snap.userId);
      snap.loadedChapterIds.forEach((id) => loadedChapterIds.current.add(id));
      setLoadedChapters(new Set(snap.loadedChapterIds));
      setSections(snap.sections);
      setActiveChapterId(snap.book.activeChapterId);
      setBook(snap.book);
      // Restore Book Info from the per-chapter cache (older snapshots predating
      // Book Info simply have no infoChapterId — skip in that case).
      if (snap.book.infoChapterId) {
        const cached = await offlineCache.readCachedChapter(snap.book.infoChapterId);
        const info: Chapter = {
          id: snap.book.infoChapterId,
          title: "Book Info",
          sectionId: "",
          scenes: cached?.scenes ?? [],
          library: cached?.library ?? { images: [], notes: [], musicLinks: [], links: [] },
        };
        infoChapterRef.current = info;
        setInfoChapter(info);
        if (cached) {
          loadedChapterIds.current.add(snap.book.infoChapterId);
          setLoadedChapters((prev) => new Set(prev).add(snap.book.infoChapterId!));
        }
      }
      setHydrated(true);
    }

    async function bootstrap() {
      // Offline from the start: skip the network entirely and hydrate from cache.
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await hydrateFromCache();
        return;
      }

      let user;
      try {
        await ensureDevSession(supabase);
        ({ data: { user } } = await supabase.auth.getUser());
      } catch {
        // Network failed mid-auth — fall back to whatever we have cached.
        await hydrateFromCache();
        return;
      }
      // Online but genuinely not signed in — respect it (don't reveal cache);
      // the page's own auth gate handles the redirect.
      if (!user) return;
      setUserId(user.id);

      let loadedBook, loadedSections, loadedInfoChapter;
      try {
        ({ book: loadedBook, sections: loadedSections, infoChapter: loadedInfoChapter } =
          await db.getOrCreateBook(user.id));
      } catch {
        await hydrateFromCache();
        return;
      }
      // Mirror the structure immediately so a later offline reload can rebuild it.
      offlineCache.cacheBook(user.id, loadedBook, loadedSections).catch(() => {});
      if (loadedBook.coverImagePath) {
        cacheImageBlobs(user.id, [loadedBook.coverImagePath]).catch(() => {});
      }

      const allChapters = loadedSections.flatMap((s) => s.chapters);
      // getOrCreateBook resolves activeChapterId to the last-edited chapter
      // (falling back to the first), so open that one on load.
      const initialChapter =
        allChapters.find((c) => c.id === loadedBook.activeChapterId) ?? allChapters[0];

      if (initialChapter) {
        const [scenes, library] = await Promise.all([
          db.getScenesForChapter(initialChapter.id),
          db.getLibraryForChapter(initialChapter.id),
        ]);
        offlineCache.cacheChapter(user.id, initialChapter.id, scenes, library).catch(() => {});
        // (the active-chapter image effect pulls this chapter's blobs)
        loadedChapterIds.current.add(initialChapter.id);
        setLoadedChapters(new Set([initialChapter.id]));
        const updatedSections = mapChapter(loadedSections, initialChapter.id, (c) => ({
          ...c,
          scenes,
          library,
        }));
        setSections(updatedSections);
        setActiveChapterId(initialChapter.id);
        setBook({ ...loadedBook, activeChapterId: initialChapter.id });
      } else {
        setSections(loadedSections);
        setBook(loadedBook);
      }

      // Load Book Info (Synopsis + Book-Info Library) up front so the surface is
      // instant when opened and available offline. Set the ref eagerly so any
      // later scene/library edit routes to it before the state settles.
      try {
        const [iScenes, iLibrary] = await Promise.all([
          db.getScenesForChapter(loadedInfoChapter.id),
          db.getLibraryForChapter(loadedInfoChapter.id),
        ]);
        offlineCache.cacheChapter(user.id, loadedInfoChapter.id, iScenes, iLibrary).catch(() => {});
        loadedChapterIds.current.add(loadedInfoChapter.id);
        setLoadedChapters((prev) => new Set(prev).add(loadedInfoChapter.id));
        infoChapterRef.current = { ...loadedInfoChapter, scenes: iScenes, library: iLibrary };
        setInfoChapter(infoChapterRef.current);
      } catch {
        infoChapterRef.current = loadedInfoChapter;
        setInfoChapter(loadedInfoChapter);
      }
      db.getBookStats(loadedBook.id).then(setBookStats).catch(() => {});

      setHydrated(true);
    }

    bootstrap();
  }, []);

  // ── Load chapter data on switch ───────────────────────────────────────
  // Caches the chapter's *text* for offline + instant switching. Image blobs are
  // deliberately NOT pulled here (they're large): the active-chapter effect below
  // downloads them only for the chapter actually being viewed, keeping egress
  // bounded whether this load came from a background prefetch or a real open.
  const loadChapter = useCallback(async (chapterId: string) => {
    if (loadedChapterIds.current.has(chapterId)) return;
    loadedChapterIds.current.add(chapterId);

    let scenes, library;
    try {
      [scenes, library] = await Promise.all([
        db.getScenesForChapter(chapterId),
        db.getLibraryForChapter(chapterId),
      ]);
      // Mirror text for offline navigation to this chapter later.
      const uid = userIdRef.current;
      if (uid) offlineCache.cacheChapter(uid, chapterId, scenes, library).catch(() => {});
    } catch (err) {
      // Offline (or a transient failure) — serve cached content if we have it so
      // the author can still open this chapter.
      const cached = await offlineCache.readCachedChapter(chapterId);
      if (cached) {
        scenes = cached.scenes;
        library = cached.library;
      } else {
        // Nothing cached: roll the dedup entry back, otherwise this chapter is
        // marked "in flight" forever and every later attempt short-circuits —
        // leaving its editor stuck on the skeleton short of a reload.
        loadedChapterIds.current.delete(chapterId);
        throw err;
      }
    }

    updateChapterState(chapterId, (c) => ({ ...c, scenes, library }));
    setLoadedChapters((prev) => {
      const next = new Set(prev);
      next.add(chapterId);
      return next;
    });
  }, [updateChapterState]);

  // ── Background prefetch ───────────────────────────────────────────────
  // After the first chapter renders, quietly load every other chapter's text so
  // switching chapters is instant (no empty flash) and the whole book's text is
  // available offline. loadChapter caches text only (not image blobs), so this is
  // cheap. Runs once; loadChapter dedups, so already-loaded chapters are skipped.
  //
  // The chapter list is read from sectionsRef, NOT a `sections` dependency: each
  // loadChapter calls setSections, so depending on `sections` would re-run this
  // effect and its cleanup would cancel the in-flight loop after one chapter.
  useEffect(() => {
    if (!hydrated || prefetchStarted.current) return;
    prefetchStarted.current = true;
    let cancelled = false;
    (async () => {
      const all = sectionsRef.current.flatMap((s) => s.chapters);
      for (const ch of all) {
        if (cancelled) break;
        await loadChapter(ch.id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, loadChapter]);

  // ── Image blobs for the chapter being viewed ──────────────────────────
  // Prefetch warms text for the whole book but skips images. Pull the active
  // chapter's image blobs here instead — this fires even when its text was
  // already prefetched (so loadChapter short-circuits). Once per chapter per
  // session; cacheImageBlobs also skips blobs already stored.
  const imagesRequestedFor = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!userId || !activeChapterId || !loadedChapters.has(activeChapterId)) return;
    if (imagesRequestedFor.current.has(activeChapterId)) return;
    imagesRequestedFor.current.add(activeChapterId);
    const chapter = sectionsRef.current.flatMap((s) => s.chapters).find((c) => c.id === activeChapterId);
    if (chapter) cacheImageBlobs(userId, chapter.library.images.map((i) => i.path)).catch(() => {});
  }, [userId, activeChapterId, loadedChapters]);

  // ── Autosave flush ─────────────────────────────────────────────────────
  // Ref indirection breaks the flush ⇄ schedule cycle: scheduleSave stays
  // stable (no deps) and reads the latest flush through this ref, so flushSaves
  // can reschedule itself (the failure-retry path) without a dependency loop.
  const flushSavesRef = useRef<() => void>(() => {});

  const scheduleSave = useCallback(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    if (firstPendingAt.current === null) firstPendingAt.current = Date.now();
    const elapsed = Date.now() - firstPendingAt.current;
    // Debounce to DELAY, but never past MAX_WAIT from the first unsaved edit.
    const delay = Math.max(0, Math.min(AUTOSAVE_DELAY, AUTOSAVE_MAX_WAIT - elapsed));
    autosaveTimer.current = setTimeout(() => flushSavesRef.current(), delay);
  }, []);

  const flushSaves = useCallback(async () => {
    if (pendingSaves.current.size === 0) return;
    // Offline: leave the queue intact (it's mirrored in IndexedDB too) and wait.
    // The `online` / focus listeners replay it, so there's no red "error" flash
    // and no retry spam while there's genuinely no network.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setSaveStatus("offline");
      return;
    }
    // Single-flight: a flush requested while one is already running (e.g. a
    // recovery-triggered flush firing mid-save) defers rather than running
    // concurrently — otherwise it could re-queue a scene with a stale base and
    // pop a spurious self-conflict.
    if (isFlushing.current) {
      flushAgain.current = true;
      return;
    }
    isFlushing.current = true;
    try {
      firstPendingAt.current = null;
      // Defer the "Saving…" indicator: only show it if the write is still going
      // after SAVE_INDICATOR_DELAY, so a fast save leaves the status untouched.
      savingShown.current = false;
      if (saveIndicatorTimer.current) clearTimeout(saveIndicatorTimer.current);
      saveIndicatorTimer.current = setTimeout(() => {
        savingShown.current = true;
        setSaveStatus("saving");
      }, SAVE_INDICATOR_DELAY);
      const saves = Array.from(pendingSaves.current.entries());
      pendingSaves.current.clear();

      // One tab at a time drains the shared queue, so two open tabs can't race the
      // same write (no-op lock where Web Locks is unsupported). Each save carries
      // its edit-time authoredAt; the server keeps whichever edit is newest, so an
      // older one is silently superseded rather than surfaced as a conflict.
      const results = await offlineQueue.runExclusive(() =>
        Promise.allSettled(
          saves.map(([sceneId, patch]) =>
            db.saveScene(sceneId, patch, pendingAuthoredAt.current.get(sceneId) ?? null)
          )
        )
      );

      // Write resolved — stop the pending "Saving…" timer. If it already fired
      // (a slow save), `savingShown` stays true and the indicator is up.
      if (saveIndicatorTimer.current) {
        clearTimeout(saveIndicatorTimer.current);
        saveIndicatorTimer.current = null;
      }

      const requeue: [string, Partial<Scene>][] = [];
      const doneIds: string[] = []; // durable copies to drop (saved, gone, or adopted)
      // Per-scene state patches to apply after the pass: a clean save advances the
      // version fields; a stale save silently adopts the newer server row's content.
      const patches = new Map<string, Partial<Scene>>();

      saves.forEach(([sceneId, patch], i) => {
        const result = results[i];
        if (result.status === "rejected") {
          // Network / unknown error — keep it (and its authoredAt) queued and retry.
          requeue.push([sceneId, patch]);
          return;
        }
        // A newer edit that landed mid-save keeps its own authoredAt and wins the
        // next flush, so don't clear its stamp or overwrite it with this result.
        const hasNewer = pendingSaves.current.has(sceneId);
        const outcome = result.value;
        if (outcome.status === "saved") {
          doneIds.push(sceneId);
          patches.set(sceneId, { updatedAt: outcome.updatedAt, contentEditedAt: outcome.contentEditedAt });
        } else if (outcome.status === "deleted") {
          // Scene removed elsewhere — drop the orphaned edit.
          doneIds.push(sceneId);
        } else {
          // Stale: the server holds a newer-or-equal edit (last-write-wins). Adopt
          // it silently — no modal, no copy — unless a newer local edit is already
          // queued, which will win the next flush and shouldn't be clobbered.
          doneIds.push(sceneId);
          if (!hasNewer) {
            patches.set(sceneId, {
              label: outcome.server.label,
              body: outcome.server.body,
              updatedAt: outcome.server.updatedAt,
              contentEditedAt: outcome.server.contentEditedAt,
            });
          }
        }
        if (!hasNewer) pendingAuthoredAt.current.delete(sceneId);
      });

      if (doneIds.length > 0) offlineQueue.removeSceneWrites(doneIds).catch(() => {});

      // Apply version advances (clean saves) and adopted server content (stale) to
      // local state. Shared mapper so `sections` and the out-of-band info chapter
      // stay in sync.
      const applyPatches = (scenes: Scene[]): { scenes: Scene[]; touched: boolean } => {
        let touched = false;
        const next = scenes.map((s) => {
          const p = patches.get(s.id);
          if (!p) return s;
          touched = true;
          return { ...s, ...p };
        });
        return { scenes: next, touched };
      };

      setSections((prev) => {
        const next =
          patches.size > 0
            ? prev.map((sec) => ({
                ...sec,
                chapters: sec.chapters.map((ch) => {
                  const applied = applyPatches(ch.scenes);
                  return applied.touched ? { ...ch, scenes: applied.scenes } : ch;
                }),
              }))
            : prev;
        const wc = wordCountAll(next);
        if (book) {
          setUnlocks((currentUnlocks) => {
            db.updateBookWordCount(book.id, wc, currentUnlocks).then((updated) => setUnlocks(updated));
            return currentUnlocks;
          });
        }
        return next;
      });

      // The Synopsis scene lives on the info chapter (outside `sections`), so apply
      // there too.
      if (patches.size > 0) {
        setInfoChapter((prev) => {
          if (!prev) return prev;
          const applied = applyPatches(prev.scenes);
          return applied.touched ? { ...prev, scenes: applied.scenes } : prev;
        });
      }

      // Re-queue any failed scene beneath edits that arrived while saving (newer
      // typing wins), so a transient failure retries instead of losing the edit.
      if (requeue.length > 0) {
        for (const [sceneId, patch] of requeue) {
          const newer = pendingSaves.current.get(sceneId);
          pendingSaves.current.set(sceneId, { ...patch, ...newer });
        }
        setSaveStatus("error");
        scheduleSave(); // retry on the normal cadence
        return;
      }

      if (savedUpdates.size > 0 && savingShown.current) {
        // The write was slow enough to show "Saving…" — close it out with a brief
        // "Saved", then hide. A fast save never showed the indicator, so skip
        // straight to idle rather than blinking "Saved" on every pause.
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } else {
        // Fast save, or only conflicts / deletions this round — stay silent.
        setSaveStatus("idle");
      }
    } finally {
      isFlushing.current = false;
      // A flush was requested while this one ran — run it now to pick up whatever
      // was queued in the meantime.
      if (flushAgain.current) {
        flushAgain.current = false;
        flushSavesRef.current();
      }
    }
  }, [book, scheduleSave]);

  flushSavesRef.current = flushSaves;

  // ── Durable-queue recovery ──────────────────────────────────────────────
  // Pull any edits left in IndexedDB — from a closed tab, a crash, or another
  // tab — back into the in-memory queue and flush them. Runs after hydration
  // and again on reconnect / focus / cross-tab signal.
  const recoverAndFlush = useCallback(async () => {
    if (!userId) return;
    const [sceneWrites, noteWrites] = await Promise.all([
      offlineQueue.readSceneWrites(userId),
      offlineQueue.readNoteWrites(userId),
    ]);
    if (sceneWrites.length === 0 && noteWrites.length === 0) return;

    const online = typeof navigator === "undefined" || navigator.onLine;

    // Scenes: merge into the in-memory queue (an in-tab edit stays newest) and
    // reflect edits recovered from elsewhere in any loaded editor.
    const showScenes = new Map<string, offlineQueue.ScenePatch>();
    for (const { id, patch, authoredAt } of sceneWrites) {
      const active = pendingSaves.current.get(id);
      if (active) {
        // Actively editing here; the in-memory copy is newer — don't disturb it
        // (its own, later authoredAt stays in pendingAuthoredAt and wins).
        pendingSaves.current.set(id, { ...patch, ...active });
      } else {
        // From a prior session / other tab: queue it and surface it so a recovered
        // edit is visible, not just re-synced. Carry the durable authoredAt so the
        // replay wins or loses on when the edit was actually made; a pre-021 row
        // has none and falls back to now() at save time.
        pendingSaves.current.set(id, patch);
        if (!pendingAuthoredAt.current.has(id) && authoredAt) {
          pendingAuthoredAt.current.set(id, authoredAt);
        }
        showScenes.set(id, patch);
      }
    }

    // Notes have no batched flush, so replay each durable copy directly when
    // online — idempotent, since IndexedDB always holds the latest note text.
    // Only surface notes that aren't being actively typed, so a live edit in
    // this tab isn't reverted to a slightly older durable value.
    const showNotes = new Map<string, offlineQueue.NotePatch>();
    for (const { id, patch } of noteWrites) {
      if (!pendingNoteSaves.current.has(id)) showNotes.set(id, patch);
      if (online) {
        db.updateNote(id, patch)
          .then(() => offlineQueue.removeNoteWrites([id]))
          .catch(() => {});
      }
    }

    if (showScenes.size > 0 || showNotes.size > 0) {
      setSections((prev) =>
        prev.map((sec) => ({
          ...sec,
          chapters: sec.chapters.map((ch) => {
            let touched = false;
            const scenes = showScenes.size
              ? ch.scenes.map((s) => {
                  const patch = showScenes.get(s.id);
                  if (!patch) return s;
                  touched = true;
                  return { ...s, ...patch };
                })
              : ch.scenes;
            const notes = showNotes.size
              ? ch.library.notes.map((n) => {
                  const patch = showNotes.get(n.id);
                  if (!patch) return n;
                  touched = true;
                  return { ...n, ...patch };
                })
              : ch.library.notes;
            return touched ? { ...ch, scenes, library: { ...ch.library, notes } } : ch;
          }),
        }))
      );
    }

    if (pendingSaves.current.size > 0) flushSavesRef.current();
  }, [userId]);

  useEffect(() => {
    if (!hydrated || !userId) return;
    recoverAndFlush();
  }, [hydrated, userId, recoverAndFlush]);

  useEffect(() => {
    const onOnline = () => recoverAndFlush();
    const onVisible = () => {
      if (document.visibilityState === "visible") recoverAndFlush();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    const unsubscribe = offlineQueue.subscribeQueue(() => recoverAndFlush());
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribe();
    };
  }, [recoverAndFlush]);

  // Persist any pending scene/note edits immediately when the writer unmounts
  // (e.g. navigating to /backups or /books) or the tab is hidden. Autosaves are
  // otherwise 30s-debounced, so without this a backup taken elsewhere could
  // snapshot stale text. Fire-and-forget — the requests outlive the unmount.
  const flushPending = useRef(() => {});
  flushPending.current = () => {
    firstPendingAt.current = null;
    if (pendingSaves.current.size > 0) {
      const saves = Array.from(pendingSaves.current.entries());
      pendingSaves.current.clear();
      // Best-effort on unmount/hide — can't re-queue after we're gone, so swallow
      // failures. Pass the edit-time authoredAt so last-write-wins still settles a
      // cross-device overlap; drop the durable copy on any resolved outcome (a
      // "stale" loss is intended silent LWW), keep it only on a network error to
      // retry on the next visit's recovery flush.
      saves.forEach(([sceneId, patch]) =>
        db
          .saveScene(sceneId, patch, pendingAuthoredAt.current.get(sceneId) ?? null)
          .then((res) => {
            if (res.status === "saved" || res.status === "deleted" || res.status === "stale") {
              offlineQueue.removeSceneWrites([sceneId]).catch(() => {});
            }
          })
          .catch(() => {})
      );
    }
    if (pendingNoteSaves.current.size > 0) {
      pendingNoteSaves.current.forEach((update, noteId) =>
        db
          .updateNote(noteId, update)
          .then(() => offlineQueue.removeNoteWrites([noteId]))
          .catch(() => {})
      );
      pendingNoteSaves.current.clear();
    }
  };

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushPending.current();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      flushPending.current();
    };
  }, []);

  // ── Book actions ──────────────────────────────────────────────────────
  const setBookTitle = useCallback(
    (title: string) => {
      setBook((b) => (b ? { ...b, title } : b));
      if (book) db.updateBookTitle(book.id, title);
    },
    [book]
  );

  // Set or clear the book cover. A file is uploaded to Storage (not inlined
  // into the row); previewDataUrl shows it instantly while the upload runs.
  const setCoverImage = useCallback(
    async (file: File | undefined, previewDataUrl?: string) => {
      if (!book || !userId) return;
      const oldPath = book.coverImagePath;

      if (!file) {
        setBook((b) => (b ? { ...b, coverImage: undefined, coverImagePath: undefined } : b));
        await db.updateBookCover(book.id, null);
        if (oldPath) db.removeBookCoverFile(oldPath).catch(() => {});
        return;
      }

      // Optimistic preview from the local data URL, replaced by the signed URL.
      if (previewDataUrl) setBook((b) => (b ? { ...b, coverImage: previewDataUrl } : b));
      const { path, signedUrl } = await db.uploadBookCover(userId, book.id, file);
      await db.updateBookCover(book.id, path);
      setBook((b) => (b ? { ...b, coverImage: signedUrl, coverImagePath: path } : b));
      // Evict the cover this one replaced so it doesn't leak in the bucket.
      if (oldPath && oldPath !== path) db.removeBookCoverFile(oldPath).catch(() => {});
    },
    [book, userId]
  );

  // Re-mint an expired signed cover URL (mirrors refreshLibraryImageUrl).
  const refreshCoverUrl = useCallback(async () => {
    if (!book?.coverImagePath) return;
    const signedUrl = await db.signBookCoverUrl(book.coverImagePath);
    if (signedUrl) setBook((b) => (b ? { ...b, coverImage: signedUrl } : b));
  }, [book]);

  // ── Book Info: tags, word-count exclusions, stats ─────────────────────
  const setBookTags = useCallback((tags: string[]) => {
    setBook((b) => (b ? { ...b, tags } : b));
    if (bookRef.current) db.updateBookTags(bookRef.current.id, tags);
  }, []);

  const toggleBookTag = useCallback((tagId: string) => {
    setBook((b) => {
      if (!b) return b;
      const current = b.tags ?? [];
      const tags = current.includes(tagId)
        ? current.filter((t) => t !== tagId)
        : [...current, tagId];
      db.updateBookTags(b.id, tags);
      return { ...b, tags };
    });
  }, []);

  // Toggle a section in/out of the "official" manuscript word count. Whole-book
  // achievements are unaffected — this only narrows the Book Info total.
  const toggleExcludedSection = useCallback((sectionId: string) => {
    setBook((b) => {
      if (!b) return b;
      const current = b.excludedSectionIds ?? [];
      const excludedSectionIds = current.includes(sectionId)
        ? current.filter((id) => id !== sectionId)
        : [...current, sectionId];
      db.updateBookExcludedSections(b.id, excludedSectionIds);
      return { ...b, excludedSectionIds };
    });
  }, []);

  // Record active writing time (drives Book Stats). Marks today a writing day
  // and adds to its active_seconds; best-effort, skipped offline. Optimistically
  // bumps local stats so the Book Info numbers move without a refetch — the next
  // load's getBookStats is authoritative and corrects any drift.
  const recordActiveTime = useCallback((seconds: number) => {
    const uid = userIdRef.current;
    const b = bookRef.current;
    if (!uid || !b || seconds <= 0) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    db.bumpWritingDay(uid, b.id, seconds).catch(() => {});
    setBookStats((prev) =>
      prev
        ? {
            ...prev,
            sessionCount: Math.max(prev.sessionCount, 1),
            totalActiveSeconds: prev.totalActiveSeconds + Math.round(seconds),
          }
        : prev
    );
  }, []);

  const setActiveChapter = useCallback(
    (id: string) => {
      setActiveChapterId(id);
      setBook((b) => {
        if (!b) return b;
        // Persist so returning to /write reopens this chapter.
        db.updateBookActiveChapter(b.id, id);
        return { ...b, activeChapterId: id };
      });
      loadChapter(id);
    },
    [loadChapter]
  );

  // ── Section actions ───────────────────────────────────────────────────
  const addSection = useCallback(
    async (afterSectionId: string) => {
      if (!book) return;
      const afterIndex = sections.findIndex((s) => s.id === afterSectionId);
      const insertAt = afterIndex + 1;
      const newSection = await db.createSection(book.id, insertAt);
      setSections((prev) => {
        const next = [...prev];
        next.splice(insertAt, 0, { ...newSection, chapters: [] });
        const normalized = next.map((s, i) => ({ ...s, position: i }));
        db.reorderSections(normalized.map((s, i) => ({ id: s.id, position: i })));
        return normalized;
      });
    },
    [book, sections]
  );

  const updateSectionLabel = useCallback((sectionId: string, label: string) => {
    setSections((prev) =>
      prev.map((s) => (s.id === sectionId ? { ...s, label } : s))
    );
    db.updateSectionLabel(sectionId, label);
  }, []);

  const reorderSections = useCallback((fromIndex: number, toIndex: number) => {
    setSections((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      const normalized = next.map((s, i) => ({ ...s, position: i }));
      db.reorderSections(normalized.map((s, i) => ({ id: s.id, position: i })));
      return normalized;
    });
  }, []);

  const deleteSection = useCallback(
    async (sectionId: string) => {
      // If active chapter is in this section, switch to first chapter elsewhere
      setSections((prev) => {
        const target = prev.find((s) => s.id === sectionId);
        if (target?.chapters.some((c) => c.id === activeChapterId)) {
          const others = prev
            .filter((s) => s.id !== sectionId)
            .flatMap((s) => s.chapters);
          const next = others[0];
          if (next) {
            setActiveChapterId(next.id);
            setBook((b) => {
              if (!b) return b;
              db.updateBookActiveChapter(b.id, next.id);
              return { ...b, activeChapterId: next.id };
            });
            loadChapter(next.id);
          }
        }
        return prev.filter((s) => s.id !== sectionId);
      });
      await db.deleteSection(sectionId);
    },
    [activeChapterId, loadChapter]
  );

  // ── Chapter actions ───────────────────────────────────────────────────
  const addChapter = useCallback(
    async (sectionId: string) => {
      if (!book) return;
      const section = sections.find((s) => s.id === sectionId);
      const position = section?.chapters.length ?? 0;
      const newChapter = await db.createChapter(book.id, sectionId, position);
      const scenes = await db.getScenesForChapter(newChapter.id);
      const fullChapter = { ...newChapter, scenes };
      // The chapter is fully materialized locally (empty scenes/library), so
      // mark it loaded in both the dedup ref and the state mirror — otherwise
      // activeChapterLoaded stays false and the skeletons never clear.
      loadedChapterIds.current.add(newChapter.id);
      setLoadedChapters((prev) => {
        const next = new Set(prev);
        next.add(newChapter.id);
        return next;
      });
      setSections((prev) =>
        prev.map((s) =>
          s.id === sectionId ? { ...s, chapters: [...s.chapters, fullChapter] } : s
        )
      );
      setActiveChapterId(newChapter.id);
      db.updateBookActiveChapter(book.id, newChapter.id);
      setBook((b) => (b ? { ...b, activeChapterId: newChapter.id } : b));
    },
    [book, sections]
  );

  const deleteChapter = useCallback(
    async (chapterId: string) => {
      const allChapters = sections.flatMap((s) => s.chapters);
      // If deleting the active chapter, switch away first
      if (chapterId === activeChapterId) {
        const others = allChapters.filter((c) => c.id !== chapterId);
        const next = others[0];
        if (next) {
          setActiveChapterId(next.id);
          setBook((b) => {
            if (!b) return b;
            db.updateBookActiveChapter(b.id, next.id);
            return { ...b, activeChapterId: next.id };
          });
          loadChapter(next.id);
        }
      }
      setSections((prev) =>
        prev.map((s) => ({
          ...s,
          chapters: s.chapters.filter((c) => c.id !== chapterId),
        }))
      );
      await db.deleteChapter(chapterId);
    },
    [sections, activeChapterId, loadChapter]
  );

  const reorderChapters = useCallback(
    (sectionId: string, fromIndex: number, toIndex: number) => {
      setSections((prev) =>
        prev.map((s) => {
          if (s.id !== sectionId) return s;
          const next = [...s.chapters];
          const [moved] = next.splice(fromIndex, 1);
          next.splice(toIndex, 0, moved);
          db.reorderChapters(next.map((c, i) => ({ id: c.id, position: i })));
          return { ...s, chapters: next };
        })
      );
    },
    []
  );

  const updateChapterTitle = useCallback((id: string, title: string) => {
    setSections((prev) => mapChapter(prev, id, (c) => ({ ...c, title })));
    db.updateChapterTitle(id, title);
  }, []);

  // ── Scene actions ─────────────────────────────────────────────────────
  const updateScene = useCallback(
    (chapterId: string, sceneId: string, patch: Partial<Scene>) => {
      // Stamp this edit with the current time (last-write-wins token). Overwritten
      // every keystroke so the flushed batch carries when the author *last* edited
      // it; a save that wins advances the row's token past it, a stale one loses.
      const authoredAt = new Date().toISOString();
      pendingAuthoredAt.current.set(sceneId, authoredAt);
      updateChapterState(chapterId, (c) => ({
        ...c,
        scenes: c.scenes.map((s) => (s.id === sceneId ? { ...s, ...patch } : s)),
      }));
      const existing = pendingSaves.current.get(sceneId) ?? {};
      const merged = { ...existing, ...patch };
      pendingSaves.current.set(sceneId, merged);
      // Mirror to IndexedDB so the edit survives a tab close / crash before the
      // debounced flush fires. Fire-and-forget; the in-memory queue is primary.
      if (userId) {
        offlineQueue.enqueueSceneWrite(userId, sceneId, merged, authoredAt).catch(() => {});
      }
      scheduleSave();
    },
    [scheduleSave, userId, updateChapterState]
  );

  const addScene = useCallback(
    async (chapterId: string) => {
      const chapter = sections.flatMap((s) => s.chapters).find((c) => c.id === chapterId);
      const position = chapter?.scenes.length ?? 0;
      const newScene = await db.createScene(chapterId, position);
      setSections((prev) =>
        mapChapter(prev, chapterId, (c) => ({ ...c, scenes: [...c.scenes, newScene] }))
      );
    },
    [sections]
  );

  // Structural writes (reorder / move / split) no longer need to reconcile a
  // concurrency base: content saves win purely on their authoredAt (LWW), which a
  // reorder never touches. So these just fire the DB write and drop the result.

  const reorderScenes = useCallback(
    (chapterId: string, fromIndex: number, toIndex: number) => {
      setSections((prev) =>
        mapChapter(prev, chapterId, (c) => {
          const next = [...c.scenes];
          const [moved] = next.splice(fromIndex, 1);
          next.splice(toIndex, 0, moved);
          db.reorderScenes(next.map((s, i) => ({ id: s.id, position: i }))).catch(() => {});
          return { ...c, scenes: next };
        })
      );
    },
    []
  );

  // Move a scene to a (possibly different) chapter, inserting at gap `toIndex`
  // in the target chapter's *current* scene list (0..len, where g means "before
  // scene g"). Same-chapter moves are just a reorder; cross-chapter moves also
  // rewrite the scene's chapter_id. The scene id is stable across the move, so
  // any pending body/label edits (keyed by id) still land correctly.
  const moveScene = useCallback(
    async (sceneId: string, fromChapterId: string, toChapterId: string, toIndex: number) => {
      // The target's scenes drive the new position map; if it hasn't loaded yet
      // its array is empty, so hydrate it before splicing to avoid clobbering.
      if (fromChapterId !== toChapterId && !loadedChapterIds.current.has(toChapterId)) {
        await loadChapter(toChapterId);
      }
      setSections((prev) => {
        const allChapters = prev.flatMap((s) => s.chapters);
        const source = allChapters.find((c) => c.id === fromChapterId);
        const scene = source?.scenes.find((s) => s.id === sceneId);
        if (!source || !scene) return prev;
        const fromIndex = source.scenes.indexOf(scene);

        if (fromChapterId === toChapterId) {
          const next = [...source.scenes];
          next.splice(fromIndex, 1);
          const insertAt = Math.max(0, Math.min(toIndex > fromIndex ? toIndex - 1 : toIndex, next.length));
          if (insertAt === fromIndex) return prev; // no-op drop onto itself
          next.splice(insertAt, 0, scene);
          db.reorderScenes(next.map((s, i) => ({ id: s.id, position: i }))).catch(() => {});
          return mapChapter(prev, fromChapterId, (c) => ({ ...c, scenes: next }));
        }

        const target = allChapters.find((c) => c.id === toChapterId);
        if (!target) return prev;
        const fromScenes = source.scenes.filter((s) => s.id !== sceneId);
        const toScenes = [...target.scenes];
        const insertAt = Math.max(0, Math.min(toIndex, toScenes.length));
        toScenes.splice(insertAt, 0, scene);
        db.moveScene(
          sceneId,
          toChapterId,
          fromScenes.map((s, i) => ({ id: s.id, position: i })),
          toScenes.map((s, i) => ({ id: s.id, position: i }))
        ).catch(() => {});
        return prev.map((sec) => ({
          ...sec,
          chapters: sec.chapters.map((c) => {
            if (c.id === fromChapterId) return { ...c, scenes: fromScenes };
            if (c.id === toChapterId) return { ...c, scenes: toScenes };
            return c;
          }),
        }));
      });
    },
    [loadChapter]
  );

  const deleteScene = useCallback(
    (chapterId: string, sceneId: string) => {
      setSections((prev) =>
        mapChapter(prev, chapterId, (c) => ({
          ...c,
          scenes: c.scenes.filter((s) => s.id !== sceneId),
        }))
      );
      pendingAuthoredAt.current.delete(sceneId);
      db.deleteScene(sceneId);
    },
    []
  );

  // Insert a new empty scene at gap `index` (0..len) within a chapter, rather
  // than appending. Renumbers the chapter's scenes so positions stay 0..n.
  const insertScene = useCallback(
    async (chapterId: string, index: number) => {
      const newScene = await db.createScene(chapterId, index);
      setSections((prev) =>
        mapChapter(prev, chapterId, (c) => {
          const next = [...c.scenes];
          const at = Math.max(0, Math.min(index, next.length));
          next.splice(at, 0, newScene);
          db.reorderScenes(next.map((s, i) => ({ id: s.id, position: i }))).catch(() => {});
          return { ...c, scenes: next };
        })
      );
    },
    []
  );

  // Split a chapter at gap `index`: scenes[index..] move into a brand-new chapter
  // inserted right after the source in the same section. The editor stays on the
  // source (top) chapter. `index` is always ≥1 and < scene count (the hover-insert
  // rows only render between scenes), so neither side ends up empty.
  const splitChapter = useCallback(
    async (chapterId: string, index: number) => {
      if (!book) return;
      const section = sections.find((s) => s.chapters.some((c) => c.id === chapterId));
      const source = section?.chapters.find((c) => c.id === chapterId);
      if (!section || !source) return;
      if (index <= 0 || index >= source.scenes.length) return;

      const keptScenes = source.scenes.slice(0, index);
      const movedScenes = source.scenes.slice(index);
      const sourceIndex = section.chapters.indexOf(source);
      const newChapter = await db.insertChapterRow(book.id, section.id, sourceIndex + 1, "");
      const fullNew = { ...newChapter, scenes: movedScenes };

      loadedChapterIds.current.add(newChapter.id);
      setLoadedChapters((prev) => new Set(prev).add(newChapter.id));

      db.splitChapter(
        newChapter.id,
        movedScenes.map((s) => s.id),
        keptScenes.map((s, i) => ({ id: s.id, position: i })),
        movedScenes.map((s, i) => ({ id: s.id, position: i }))
      ).catch(() => {});

      setSections((prev) =>
        prev.map((sec) => {
          if (sec.id !== section.id) return sec;
          const chapters = sec.chapters.map((c) => (c.id === chapterId ? { ...c, scenes: keptScenes } : c));
          const idx = chapters.findIndex((c) => c.id === chapterId);
          chapters.splice(idx + 1, 0, fullNew);
          db.reorderChapters(chapters.map((c, i) => ({ id: c.id, position: i })));
          return { ...sec, chapters };
        })
      );
    },
    [book, sections]
  );

  // Duplicate a chapter (title + scenes only; library starts empty). The copy is
  // inserted right after the source and named "… Copy" / "… Copy N". Active
  // chapter is unchanged.
  const duplicateChapter = useCallback(
    async (chapterId: string) => {
      if (!book) return;
      const section = sections.find((s) => s.chapters.some((c) => c.id === chapterId));
      const source = section?.chapters.find((c) => c.id === chapterId);
      if (!section || !source) return;

      // Source scenes are usually prefetched; if not, read them from the DB
      // (avoids a stale closure after an await on loadChapter).
      const srcScenes = source.scenes.length
        ? source.scenes
        : await db.getScenesForChapter(chapterId);

      const title = uniqueCopyTitle(source.title, section.chapters.map((c) => c.title));
      const sourceIndex = section.chapters.indexOf(source);
      const newChapter = await db.insertChapterRow(book.id, section.id, sourceIndex + 1, title);
      const copiedScenes = await db.duplicateChapterScenes(
        newChapter.id,
        srcScenes.map((s) => ({ label: s.label, body: s.body }))
      );
      const fullNew = { ...newChapter, scenes: copiedScenes };

      loadedChapterIds.current.add(newChapter.id);
      setLoadedChapters((prev) => new Set(prev).add(newChapter.id));

      setSections((prev) =>
        prev.map((sec) => {
          if (sec.id !== section.id) return sec;
          const chapters = [...sec.chapters];
          const idx = chapters.findIndex((c) => c.id === chapterId);
          chapters.splice(idx + 1, 0, fullNew);
          db.reorderChapters(chapters.map((c, i) => ({ id: c.id, position: i })));
          return { ...sec, chapters };
        })
      );
    },
    [book, sections]
  );

  // Move a chapter to a (possibly different) section, inserting at gap `toIndex`
  // in the target section's current chapter list. Same-section is a reorder;
  // cross-section also rewrites the chapter's section_id. The chapter id is
  // stable, so the active chapter (if it's the one moved) keeps its content.
  const moveChapter = useCallback(
    (chapterId: string, fromSectionId: string, toSectionId: string, toIndex: number) => {
      setSections((prev) => {
        const fromSec = prev.find((s) => s.id === fromSectionId);
        const chapter = fromSec?.chapters.find((c) => c.id === chapterId);
        if (!fromSec || !chapter) return prev;
        const fromIndex = fromSec.chapters.indexOf(chapter);

        if (fromSectionId === toSectionId) {
          const next = [...fromSec.chapters];
          next.splice(fromIndex, 1);
          const insertAt = Math.max(0, Math.min(toIndex > fromIndex ? toIndex - 1 : toIndex, next.length));
          if (insertAt === fromIndex) return prev;
          next.splice(insertAt, 0, chapter);
          db.reorderChapters(next.map((c, i) => ({ id: c.id, position: i })));
          return prev.map((s) => (s.id === fromSectionId ? { ...s, chapters: next } : s));
        }

        const toSec = prev.find((s) => s.id === toSectionId);
        if (!toSec) return prev;
        const fromChapters = fromSec.chapters.filter((c) => c.id !== chapterId);
        const toChapters = [...toSec.chapters];
        const insertAt = Math.max(0, Math.min(toIndex, toChapters.length));
        toChapters.splice(insertAt, 0, { ...chapter, sectionId: toSectionId });
        db.moveChapter(
          chapterId,
          toSectionId,
          fromChapters.map((c, i) => ({ id: c.id, position: i })),
          toChapters.map((c, i) => ({ id: c.id, position: i }))
        );
        return prev.map((s) => {
          if (s.id === fromSectionId) return { ...s, chapters: fromChapters };
          if (s.id === toSectionId) return { ...s, chapters: toChapters };
          return s;
        });
      });
    },
    []
  );

  // ── Library actions ───────────────────────────────────────────────────
  const addLibraryImage = useCallback(
    async (chapterId: string, img: LibraryImage) => {
      if (!userId) return;
      const chapter = findChapter(chapterId);
      const position = chapter?.library.images.length ?? 0;
      const saved = await db.addLibraryImageFromDataUrl(chapterId, userId, img.dataUrl, img.name, position);
      updateChapterState(chapterId, (c) => ({
        ...c,
        library: { ...c.library, images: [...c.library.images, saved] },
      }));
    },
    [userId, findChapter, updateChapterState]
  );

  // Re-mint an expired signed URL for a stored image and swap it into state.
  // Triggered by the gallery's <img> onError when a 24h signed URL lapses.
  const refreshLibraryImageUrl = useCallback(async (chapterId: string, imageId: string) => {
    const chapter = findChapter(chapterId);
    const img = chapter?.library.images.find((i) => i.id === imageId);
    if (!img?.path) return;
    const dataUrl = await db.signLibraryImageUrl(img.path);
    if (!dataUrl) return;
    updateChapterState(chapterId, (c) => ({
      ...c,
      library: {
        ...c.library,
        images: c.library.images.map((i) => (i.id === imageId ? { ...i, dataUrl } : i)),
      },
    }));
  }, [findChapter, updateChapterState]);

  const removeLibraryImage = useCallback(async (chapterId: string, imageId: string) => {
    // Grab the storage path before the image leaves state, so the stored
    // blob is deleted along with the row instead of leaking in the bucket.
    const chapter = findChapter(chapterId);
    const path = chapter?.library.images.find((i) => i.id === imageId)?.path;
    updateChapterState(chapterId, (c) => ({
      ...c,
      library: { ...c.library, images: c.library.images.filter((i) => i.id !== imageId) },
    }));
    await db.removeLibraryItem(imageId, path);
  }, [findChapter, updateChapterState]);

  const addNote = useCallback(
    async (chapterId: string) => {
      const chapter = findChapter(chapterId);
      const position = chapter?.library.notes.length ?? 0;
      const saved = await db.addNote(chapterId, { title: "", body: "" }, position);
      updateChapterState(chapterId, (c) => ({
        ...c,
        library: { ...c.library, notes: [...c.library.notes, saved] },
      }));
      return saved;
    },
    [findChapter, updateChapterState]
  );

  const updateNote = useCallback(
    (chapterId: string, noteId: string, patch: { title?: string; body?: string }) => {
      updateChapterState(chapterId, (c) => ({
        ...c,
        library: {
          ...c.library,
          notes: c.library.notes.map((n) => (n.id === noteId ? { ...n, ...patch } : n)),
        },
      }));
      const merged = { ...(pendingNoteSaves.current.get(noteId) ?? {}), ...patch };
      pendingNoteSaves.current.set(noteId, merged);
      // Mirror to IndexedDB so an offline note edit survives a tab close; the
      // reconnect/focus recovery replays it. Fire-and-forget.
      if (userId) offlineQueue.enqueueNoteWrite(userId, noteId, merged).catch(() => {});
      const existingTimer = noteTimers.current.get(noteId);
      if (existingTimer) clearTimeout(existingTimer);
      noteTimers.current.set(
        noteId,
        setTimeout(() => {
          const update = pendingNoteSaves.current.get(noteId);
          noteTimers.current.delete(noteId);
          if (!update) return;
          pendingNoteSaves.current.delete(noteId);
          // On success, drop the durable copy. On failure, restore beneath any
          // newer edit so the note isn't lost — it retries on the next
          // keystroke, the unmount/hide flush, or reconnect recovery (the
          // durable copy stays in IndexedDB until a save lands).
          db.updateNote(noteId, update)
            .then(() => offlineQueue.removeNoteWrites([noteId]))
            .catch(() => {
              const newer = pendingNoteSaves.current.get(noteId);
              pendingNoteSaves.current.set(noteId, { ...update, ...newer });
            });
        }, 1500)
      );
    },
    [userId, updateChapterState]
  );

  const removeNote = useCallback(async (chapterId: string, noteId: string) => {
    updateChapterState(chapterId, (c) => ({
      ...c,
      library: { ...c.library, notes: c.library.notes.filter((n) => n.id !== noteId) },
    }));
    await db.removeLibraryItem(noteId);
  }, [updateChapterState]);

  const addMusicLink = useCallback(
    async (chapterId: string, link: LibraryMusicLink) => {
      const chapter = findChapter(chapterId);
      const position = chapter?.library.musicLinks.length ?? 0;
      const { id: _id, ...rest } = link;
      const saved = await db.addMusicLink(chapterId, rest, position);
      updateChapterState(chapterId, (c) => ({
        ...c,
        library: { ...c.library, musicLinks: [...c.library.musicLinks, saved] },
      }));
    },
    [findChapter, updateChapterState]
  );

  const removeMusicLink = useCallback(async (chapterId: string, linkId: string) => {
    updateChapterState(chapterId, (c) => ({
      ...c,
      library: { ...c.library, musicLinks: c.library.musicLinks.filter((l) => l.id !== linkId) },
    }));
    await db.removeLibraryItem(linkId);
  }, [updateChapterState]);

  const addLink = useCallback(
    async (chapterId: string, link: LibraryLink) => {
      const chapter = findChapter(chapterId);
      const position = chapter?.library.links.length ?? 0;
      const { id: _id, ...rest } = link;
      const saved = await db.addLink(chapterId, rest, position);
      updateChapterState(chapterId, (c) => ({
        ...c,
        library: { ...c.library, links: [...c.library.links, saved] },
      }));
    },
    [findChapter, updateChapterState]
  );

  const removeLink = useCallback(async (chapterId: string, linkId: string) => {
    updateChapterState(chapterId, (c) => ({
      ...c,
      library: { ...c.library, links: c.library.links.filter((l) => l.id !== linkId) },
    }));
    await db.removeLibraryItem(linkId);
  }, [updateChapterState]);

  // Reorder a library sub-list (images / music links / notes). Positions are
  // rewritten 0..n for that list and persisted, mirroring reorderScenes.
  const reorderLibraryImages = useCallback((chapterId: string, fromIndex: number, toIndex: number) => {
    updateChapterState(chapterId, (c) => {
      const next = [...c.library.images];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      db.reorderLibraryItems(next.map((it, i) => ({ id: it.id, position: i })));
      return { ...c, library: { ...c.library, images: next } };
    });
  }, [updateChapterState]);

  const reorderMusicLinks = useCallback((chapterId: string, fromIndex: number, toIndex: number) => {
    updateChapterState(chapterId, (c) => {
      const next = [...c.library.musicLinks];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      db.reorderLibraryItems(next.map((it, i) => ({ id: it.id, position: i })));
      return { ...c, library: { ...c.library, musicLinks: next } };
    });
  }, [updateChapterState]);

  const reorderNotes = useCallback((chapterId: string, fromIndex: number, toIndex: number) => {
    updateChapterState(chapterId, (c) => {
      const next = [...c.library.notes];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      db.reorderLibraryItems(next.map((it, i) => ({ id: it.id, position: i })));
      return { ...c, library: { ...c.library, notes: next } };
    });
  }, [updateChapterState]);

  const allChapters = sections.flatMap((s) => s.chapters);
  const activeChapter = allChapters.find((c) => c.id === activeChapterId) ?? allChapters[0];
  const activeChapterLoaded = activeChapter ? loadedChapters.has(activeChapter.id) : false;
  // Side-by-side's second pane resolves its own chapter, so it needs the same
  // "is this one's content here yet?" test the active pane gets. Background
  // prefetch usually wins the race, but a pane restored on first paint can beat it.
  const isChapterLoaded = useCallback(
    (chapterId: string) => loadedChapters.has(chapterId),
    [loadedChapters]
  );
  // Recomputes only when `sections` changes identity; the per-chapter cache
  // then makes that recompute touch just the edited chapter.
  const wordCount = useMemo(() => wordCountAll(sections), [sections]);
  // The "official" manuscript count shown in Book Stats: whole-book, minus any
  // sections the author unchecked in the ••• menu. Whole-book achievements still
  // use `wordCount` — this only narrows the Book Info total.
  const excludedSectionIds = book?.excludedSectionIds ?? [];
  const officialWordCount = useMemo(
    () => wordCountAll(sections.filter((s) => !excludedSectionIds.includes(s.id))),
    [sections, excludedSectionIds]
  );
  const infoChapterLoaded = infoChapter ? loadedChapters.has(infoChapter.id) : false;

  return {
    userId,
    book,
    hydrated,
    saveStatus,
    activeChapter,
    activeChapterLoaded,
    isChapterLoaded,
    loadChapter,
    sections,
    wordCount,
    officialWordCount,
    infoChapter,
    infoChapterLoaded,
    bookStats,
    setBookTags,
    toggleBookTag,
    toggleExcludedSection,
    recordActiveTime,
    unlocks,
    setBookTitle,
    setCoverImage,
    refreshCoverUrl,
    setActiveChapter,
    addSection,
    updateSectionLabel,
    reorderSections,
    deleteSection,
    addChapter,
    deleteChapter,
    reorderChapters,
    updateChapterTitle,
    updateScene,
    addScene,
    insertScene,
    reorderScenes,
    moveScene,
    splitChapter,
    duplicateChapter,
    moveChapter,
    deleteScene,
    addLibraryImage,
    removeLibraryImage,
    refreshLibraryImageUrl,
    reorderLibraryImages,
    addNote,
    updateNote,
    removeNote,
    reorderNotes,
    addMusicLink,
    removeMusicLink,
    reorderMusicLinks,
    addLink,
    removeLink,
  };
}
