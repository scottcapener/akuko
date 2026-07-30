"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "./supabase/client";
import { ensureDevSession } from "./ensureDevSession";
import * as db from "./db";
import * as offlineQueue from "./offlineQueue";
import * as offlineCache from "./offlineCache";
import { Book, Section, Chapter, Scene, LibraryImage, LibraryNote, LibraryMusicLink, LibraryLink } from "./types";

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "offline";

// A scene whose queued edit couldn't save because the scene changed elsewhere
// (another device / tab) since the edit was made. Surfaced to the user to
// resolve rather than silently overwriting either side.
export interface SceneConflict {
  sceneId: string;
  chapterId: string | null;
  chapterTitle: string | null;
  mine: { label: string; body: string }; // this device's local version
  theirs: { label: string; body: string; updatedAt: string }; // current server version
}

// Autosave is debounced: a burst of typing collapses into one write DELAY ms
// after the last keystroke. MAX_WAIT caps how long unsaved edits can sit while
// someone types continuously (pure debounce would never fire mid-stream), so
// the unsaved window stays small even without a pause.
const AUTOSAVE_DELAY = 2_000;
const AUTOSAVE_MAX_WAIT = 10_000;

// Whitespace-token count of a scene body. (Bodies are contentEditable HTML, so
// this is the same crude tokenizer the app has always used — unchanged here.)
function countWords(body: string): number {
  const trimmed = body.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// Per-chapter word-count cache keyed on the chapter's `scenes` array reference.
// Editing a scene yields a new scenes array for only that chapter (mapChapter
// keeps the others referentially stable), so a keystroke recomputes one
// chapter instead of re-splitting every scene of every chapter each render.
const chapterWordCounts = new WeakMap<Scene[], number>();

function chapterWordCount(scenes: Scene[]): number {
  const cached = chapterWordCounts.get(scenes);
  if (cached !== undefined) return cached;
  const total = scenes.reduce((st, sc) => st + countWords(sc.body), 0);
  chapterWordCounts.set(scenes, total);
  return total;
}

function wordCountAll(sections: Section[]): number {
  return sections.reduce(
    (total, s) => total + s.chapters.reduce((ct, ch) => ct + chapterWordCount(ch.scenes), 0),
    0
  );
}

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

  const [conflicts, setConflicts] = useState<SceneConflict[]>([]);

  const pendingSaves = useRef<Map<string, Partial<Scene>>>(new Map());
  // Optimistic-concurrency base per dirty scene — the `updatedAt` the pending
  // edit was derived from. Captured when a scene first goes dirty and advanced
  // on each successful save; used to detect conflicts on flush.
  const pendingBases = useRef<Map<string, string | null>>(new Map());
  const pendingNoteSaves = useRef<Map<string, { title?: string; body?: string }>>(new Map());
  const noteTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Timestamp of the oldest unsaved edit in the current pending batch, so the
  // debounce can be capped at AUTOSAVE_MAX_WAIT from the first edit.
  const firstPendingAt = useRef<number | null>(null);
  const initialized = useRef(false);
  const loadedChapterIds = useRef(new Set<string>());
  // State mirror of loadedChapterIds so the UI can render a skeleton until a
  // chapter's content has arrived. The ref stays the source of truth for dedup.
  const [loadedChapters, setLoadedChapters] = useState<Set<string>>(new Set());
  const prefetchStarted = useRef(false);

  // Refs mirror the latest state so async callbacks (flush, recovery, conflict
  // resolution) can read current scenes/conflicts without re-subscribing on
  // every keystroke.
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const conflictsRef = useRef(conflicts);
  conflictsRef.current = conflicts;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  // ── Bootstrap ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

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

      let loadedBook, loadedSections;
      try {
        ({ book: loadedBook, sections: loadedSections } = await db.getOrCreateBook(user.id));
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
        cacheImageBlobs(user.id, library.images.map((i) => i.path)).catch(() => {});
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
      setHydrated(true);
    }

    bootstrap();
  }, []);

  // ── Load chapter data on switch ───────────────────────────────────────
  const loadChapter = useCallback(async (chapterId: string) => {
    if (loadedChapterIds.current.has(chapterId)) return;
    loadedChapterIds.current.add(chapterId);

    let scenes, library;
    try {
      [scenes, library] = await Promise.all([
        db.getScenesForChapter(chapterId),
        db.getLibraryForChapter(chapterId),
      ]);
      // Mirror for offline navigation to this chapter later.
      const uid = userIdRef.current;
      if (uid) {
        offlineCache.cacheChapter(uid, chapterId, scenes, library).catch(() => {});
        cacheImageBlobs(uid, library.images.map((i) => i.path)).catch(() => {});
      }
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

    setSections((prev) => mapChapter(prev, chapterId, (c) => ({ ...c, scenes, library })));
    setLoadedChapters((prev) => {
      const next = new Set(prev);
      next.add(chapterId);
      return next;
    });
  }, []);

  // ── Background prefetch ───────────────────────────────────────────────
  // After the first chapter renders, quietly load every other chapter's
  // content so switching chapters is instant (no empty flash). Runs once;
  // loadChapter dedups, so already-loaded chapters are skipped.
  useEffect(() => {
    if (!hydrated || prefetchStarted.current) return;
    prefetchStarted.current = true;
    let cancelled = false;
    (async () => {
      const all = sections.flatMap((s) => s.chapters);
      for (const ch of all) {
        if (cancelled) break;
        await loadChapter(ch.id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, sections, loadChapter]);

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
    firstPendingAt.current = null;
    setSaveStatus("saving");
    const saves = Array.from(pendingSaves.current.entries());
    pendingSaves.current.clear();

    // One tab at a time drains the shared queue, so two open tabs can't race the
    // same write (no-op lock where Web Locks is unsupported). Each save is
    // conditioned on the scene's base version so a cross-device change surfaces
    // as a conflict instead of a silent overwrite.
    const results = await offlineQueue.runExclusive(() =>
      Promise.allSettled(
        saves.map(([sceneId, patch]) =>
          db.saveScene(sceneId, patch, pendingBases.current.get(sceneId) ?? null)
        )
      )
    );

    const requeue: [string, Partial<Scene>][] = [];
    const doneIds: string[] = []; // durable copies to drop (saved or gone)
    const savedUpdates = new Map<string, string>(); // sceneId → new updatedAt
    const newConflicts: SceneConflict[] = [];

    saves.forEach(([sceneId, patch], i) => {
      const result = results[i];
      if (result.status === "rejected") {
        // Network / unknown error — keep it (and its base) queued and retry.
        requeue.push([sceneId, patch]);
        return;
      }
      const outcome = result.value;
      if (outcome.status === "saved") {
        savedUpdates.set(sceneId, outcome.updatedAt);
        doneIds.push(sceneId);
        pendingBases.current.delete(sceneId);
      } else if (outcome.status === "deleted") {
        // Scene removed elsewhere — drop the orphaned edit.
        doneIds.push(sceneId);
        pendingBases.current.delete(sceneId);
      } else {
        // Conflict: hand it to the user. Leave the durable copy in IndexedDB so
        // an unresolved conflict survives a reload (recovery skips it meanwhile).
        const local = sectionsRef.current
          .flatMap((s) => s.chapters)
          .flatMap((c) => c.scenes.map((sc) => ({ scene: sc, chapter: c })))
          .find((x) => x.scene.id === sceneId);
        newConflicts.push({
          sceneId,
          chapterId: local?.chapter.id ?? null,
          chapterTitle: local?.chapter.title ?? null,
          mine: {
            label: patch.label ?? local?.scene.label ?? outcome.server.label,
            body: patch.body ?? local?.scene.body ?? outcome.server.body,
          },
          theirs: outcome.server,
        });
        pendingBases.current.delete(sceneId);
      }
    });

    if (doneIds.length > 0) offlineQueue.removeSceneWrites(doneIds).catch(() => {});

    // Advance the concurrency base for cleanly-saved scenes so the next edit
    // conditions on the version we just wrote; recompute the word count too.
    setSections((prev) => {
      const next =
        savedUpdates.size > 0
          ? prev.map((sec) => ({
              ...sec,
              chapters: sec.chapters.map((ch) => {
                let touched = false;
                const scenes = ch.scenes.map((s) => {
                  const updatedAt = savedUpdates.get(s.id);
                  if (!updatedAt) return s;
                  touched = true;
                  return { ...s, updatedAt };
                });
                return touched ? { ...ch, scenes } : ch;
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

    if (newConflicts.length > 0) {
      setConflicts((prev) => [
        ...prev.filter((c) => !newConflicts.some((n) => n.sceneId === c.sceneId)),
        ...newConflicts,
      ]);
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

    if (savedUpdates.size > 0) {
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } else {
      // Only conflicts / deletions this round — nothing successfully written.
      setSaveStatus("idle");
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
    for (const { id, patch, baseUpdatedAt } of sceneWrites) {
      // A conflict awaiting the user's decision — don't re-queue or it'd just
      // re-detect the same conflict on every reconnect/focus.
      if (conflictsRef.current.some((c) => c.sceneId === id)) continue;
      const active = pendingSaves.current.get(id);
      if (active) {
        // Actively editing here; the in-memory copy is newer — don't disturb it.
        pendingSaves.current.set(id, { ...patch, ...active });
      } else {
        // From a prior session / other tab: queue it and surface it so a
        // recovered edit is visible, not just re-synced. Carry the durable base
        // so the flush conditions on the version the edit was derived from.
        pendingSaves.current.set(id, patch);
        if (!pendingBases.current.has(id)) pendingBases.current.set(id, baseUpdatedAt);
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

  // ── Conflict resolution ─────────────────────────────────────────────────
  // "theirs" adopts the server version; "mine" force-writes the local version
  // over it (conditioned on the server version we're overwriting, so a further
  // concurrent change re-opens the conflict rather than clobbering).
  const resolveConflict = useCallback(async (sceneId: string, choice: "mine" | "theirs") => {
    const conflict = conflictsRef.current.find((c) => c.sceneId === sceneId);
    if (!conflict) return;

    const setScene = (patch: Partial<Scene>) =>
      setSections((prev) =>
        prev.map((sec) => ({
          ...sec,
          chapters: sec.chapters.map((ch) => {
            if (!ch.scenes.some((s) => s.id === sceneId)) return ch;
            return {
              ...ch,
              scenes: ch.scenes.map((s) => (s.id === sceneId ? { ...s, ...patch } : s)),
            };
          }),
        }))
      );

    if (choice === "theirs") {
      setScene({ label: conflict.theirs.label, body: conflict.theirs.body, updatedAt: conflict.theirs.updatedAt });
    } else {
      try {
        const res = await db.saveScene(
          sceneId,
          { label: conflict.mine.label, body: conflict.mine.body },
          conflict.theirs.updatedAt
        );
        if (res.status === "conflict") {
          // Raced again — refresh "theirs" and leave the conflict open.
          setConflicts((prev) => prev.map((c) => (c.sceneId === sceneId ? { ...c, theirs: res.server } : c)));
          return;
        }
        if (res.status === "saved") setScene({ updatedAt: res.updatedAt });
        // "deleted" → the scene is gone; just clear the conflict below.
      } catch {
        return; // network error — leave the conflict for another try
      }
    }

    offlineQueue.removeSceneWrites([sceneId]).catch(() => {});
    pendingSaves.current.delete(sceneId);
    pendingBases.current.delete(sceneId);
    setConflicts((prev) => prev.filter((c) => c.sceneId !== sceneId));
  }, []);

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
      // Best-effort on unmount/hide — can't re-queue or show conflict UI after
      // we're gone, so just swallow failures. Still pass the concurrency base so
      // this path can't silently clobber a cross-device change: only drop the
      // durable copy on a clean save; a conflict stays queued and is surfaced on
      // the next visit's recovery flush.
      saves.forEach(([sceneId, patch]) =>
        db
          .saveScene(sceneId, patch, pendingBases.current.get(sceneId) ?? null)
          .then((res) => {
            if (res.status === "saved" || res.status === "deleted") {
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
      // Capture the concurrency base the first time this scene goes dirty — the
      // server version it's being edited from. Held (not re-captured per
      // keystroke) until a save advances it, so the whole edit conditions on it.
      if (!pendingBases.current.has(sceneId)) {
        const scene = sectionsRef.current
          .flatMap((s) => s.chapters)
          .flatMap((c) => c.scenes)
          .find((s) => s.id === sceneId);
        pendingBases.current.set(sceneId, scene?.updatedAt ?? null);
      }
      setSections((prev) =>
        mapChapter(prev, chapterId, (c) => ({
          ...c,
          scenes: c.scenes.map((s) => (s.id === sceneId ? { ...s, ...patch } : s)),
        }))
      );
      const existing = pendingSaves.current.get(sceneId) ?? {};
      const merged = { ...existing, ...patch };
      pendingSaves.current.set(sceneId, merged);
      // Mirror to IndexedDB so the edit survives a tab close / crash before the
      // debounced flush fires. Fire-and-forget; the in-memory queue is primary.
      if (userId) {
        offlineQueue
          .enqueueSceneWrite(userId, sceneId, merged, pendingBases.current.get(sceneId) ?? null)
          .catch(() => {});
      }
      scheduleSave();
    },
    [scheduleSave, userId]
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

  const reorderScenes = useCallback(
    (chapterId: string, fromIndex: number, toIndex: number) => {
      setSections((prev) =>
        mapChapter(prev, chapterId, (c) => {
          const next = [...c.scenes];
          const [moved] = next.splice(fromIndex, 1);
          next.splice(toIndex, 0, moved);
          db.reorderScenes(next.map((s, i) => ({ id: s.id, position: i })));
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
          db.reorderScenes(next.map((s, i) => ({ id: s.id, position: i })));
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
        );
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
          db.reorderScenes(next.map((s, i) => ({ id: s.id, position: i })));
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
      );

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
      const chapter = sections.flatMap((s) => s.chapters).find((c) => c.id === chapterId);
      const position = chapter?.library.images.length ?? 0;
      const saved = await db.addLibraryImageFromDataUrl(chapterId, userId, img.dataUrl, img.name, position);
      setSections((prev) =>
        mapChapter(prev, chapterId, (c) => ({
          ...c,
          library: { ...c.library, images: [...c.library.images, saved] },
        }))
      );
    },
    [userId, sections]
  );

  // Re-mint an expired signed URL for a stored image and swap it into state.
  // Triggered by the gallery's <img> onError when a 24h signed URL lapses.
  const refreshLibraryImageUrl = useCallback(async (chapterId: string, imageId: string) => {
    const chapter = sections.flatMap((s) => s.chapters).find((c) => c.id === chapterId);
    const img = chapter?.library.images.find((i) => i.id === imageId);
    if (!img?.path) return;
    const dataUrl = await db.signLibraryImageUrl(img.path);
    if (!dataUrl) return;
    setSections((prev) =>
      mapChapter(prev, chapterId, (c) => ({
        ...c,
        library: {
          ...c.library,
          images: c.library.images.map((i) => (i.id === imageId ? { ...i, dataUrl } : i)),
        },
      }))
    );
  }, [sections]);

  const removeLibraryImage = useCallback(async (chapterId: string, imageId: string) => {
    // Grab the storage path before the image leaves state, so the stored
    // blob is deleted along with the row instead of leaking in the bucket.
    const chapter = sections.flatMap((s) => s.chapters).find((c) => c.id === chapterId);
    const path = chapter?.library.images.find((i) => i.id === imageId)?.path;
    setSections((prev) =>
      mapChapter(prev, chapterId, (c) => ({
        ...c,
        library: { ...c.library, images: c.library.images.filter((i) => i.id !== imageId) },
      }))
    );
    await db.removeLibraryItem(imageId, path);
  }, [sections]);

  const addNote = useCallback(
    async (chapterId: string) => {
      const chapter = sections.flatMap((s) => s.chapters).find((c) => c.id === chapterId);
      const position = chapter?.library.notes.length ?? 0;
      const saved = await db.addNote(chapterId, { title: "", body: "" }, position);
      setSections((prev) =>
        mapChapter(prev, chapterId, (c) => ({
          ...c,
          library: { ...c.library, notes: [...c.library.notes, saved] },
        }))
      );
      return saved;
    },
    [sections]
  );

  const updateNote = useCallback(
    (chapterId: string, noteId: string, patch: { title?: string; body?: string }) => {
      setSections((prev) =>
        mapChapter(prev, chapterId, (c) => ({
          ...c,
          library: {
            ...c.library,
            notes: c.library.notes.map((n) => (n.id === noteId ? { ...n, ...patch } : n)),
          },
        }))
      );
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
    [userId]
  );

  const removeNote = useCallback(async (chapterId: string, noteId: string) => {
    setSections((prev) =>
      mapChapter(prev, chapterId, (c) => ({
        ...c,
        library: { ...c.library, notes: c.library.notes.filter((n) => n.id !== noteId) },
      }))
    );
    await db.removeLibraryItem(noteId);
  }, []);

  const addMusicLink = useCallback(
    async (chapterId: string, link: LibraryMusicLink) => {
      const chapter = sections.flatMap((s) => s.chapters).find((c) => c.id === chapterId);
      const position = chapter?.library.musicLinks.length ?? 0;
      const { id: _id, ...rest } = link;
      const saved = await db.addMusicLink(chapterId, rest, position);
      setSections((prev) =>
        mapChapter(prev, chapterId, (c) => ({
          ...c,
          library: { ...c.library, musicLinks: [...c.library.musicLinks, saved] },
        }))
      );
    },
    [sections]
  );

  const removeMusicLink = useCallback(async (chapterId: string, linkId: string) => {
    setSections((prev) =>
      mapChapter(prev, chapterId, (c) => ({
        ...c,
        library: { ...c.library, musicLinks: c.library.musicLinks.filter((l) => l.id !== linkId) },
      }))
    );
    await db.removeLibraryItem(linkId);
  }, []);

  const addLink = useCallback(
    async (chapterId: string, link: LibraryLink) => {
      const chapter = sections.flatMap((s) => s.chapters).find((c) => c.id === chapterId);
      const position = chapter?.library.links.length ?? 0;
      const { id: _id, ...rest } = link;
      const saved = await db.addLink(chapterId, rest, position);
      setSections((prev) =>
        mapChapter(prev, chapterId, (c) => ({
          ...c,
          library: { ...c.library, links: [...c.library.links, saved] },
        }))
      );
    },
    [sections]
  );

  const removeLink = useCallback(async (chapterId: string, linkId: string) => {
    setSections((prev) =>
      mapChapter(prev, chapterId, (c) => ({
        ...c,
        library: { ...c.library, links: c.library.links.filter((l) => l.id !== linkId) },
      }))
    );
    await db.removeLibraryItem(linkId);
  }, []);

  // Reorder a library sub-list (images / music links / notes). Positions are
  // rewritten 0..n for that list and persisted, mirroring reorderScenes.
  const reorderLibraryImages = useCallback((chapterId: string, fromIndex: number, toIndex: number) => {
    setSections((prev) =>
      mapChapter(prev, chapterId, (c) => {
        const next = [...c.library.images];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        db.reorderLibraryItems(next.map((it, i) => ({ id: it.id, position: i })));
        return { ...c, library: { ...c.library, images: next } };
      })
    );
  }, []);

  const reorderMusicLinks = useCallback((chapterId: string, fromIndex: number, toIndex: number) => {
    setSections((prev) =>
      mapChapter(prev, chapterId, (c) => {
        const next = [...c.library.musicLinks];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        db.reorderLibraryItems(next.map((it, i) => ({ id: it.id, position: i })));
        return { ...c, library: { ...c.library, musicLinks: next } };
      })
    );
  }, []);

  const reorderNotes = useCallback((chapterId: string, fromIndex: number, toIndex: number) => {
    setSections((prev) =>
      mapChapter(prev, chapterId, (c) => {
        const next = [...c.library.notes];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        db.reorderLibraryItems(next.map((it, i) => ({ id: it.id, position: i })));
        return { ...c, library: { ...c.library, notes: next } };
      })
    );
  }, []);

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

  return {
    book,
    hydrated,
    saveStatus,
    conflicts,
    resolveConflict,
    activeChapter,
    activeChapterLoaded,
    isChapterLoaded,
    loadChapter,
    sections,
    wordCount,
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
