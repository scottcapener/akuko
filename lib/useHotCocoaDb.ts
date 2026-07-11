"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "./supabase/client";
import { ensureDevSession } from "./ensureDevSession";
import * as db from "./db";
import { Book, Section, Chapter, Scene, LibraryImage, LibraryNote, LibraryMusicLink, LibraryLink } from "./types";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

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

// Helper: update a single chapter anywhere in sections
function mapChapter(sections: Section[], chapterId: string, fn: (c: Chapter) => Chapter): Section[] {
  return sections.map((s) => ({
    ...s,
    chapters: s.chapters.map((c) => (c.id === chapterId ? fn(c) : c)),
  }));
}

export function useHotCocoaDb() {
  const [userId, setUserId] = useState<string | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [hydrated, setHydrated] = useState(false);
  const [unlocks, setUnlocks] = useState<number[]>([]);

  const pendingSaves = useRef<Map<string, Partial<Scene>>>(new Map());
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

  // ── Bootstrap ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const supabase = createClient();

    async function bootstrap() {
      await ensureDevSession(supabase);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { book: loadedBook, sections: loadedSections } = await db.getOrCreateBook(user.id);

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

    const [scenes, library] = await Promise.all([
      db.getScenesForChapter(chapterId),
      db.getLibraryForChapter(chapterId),
    ]);

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
    firstPendingAt.current = null;
    setSaveStatus("saving");
    const saves = Array.from(pendingSaves.current.entries());
    pendingSaves.current.clear();

    const results = await Promise.allSettled(
      saves.map(([sceneId, patch]) => db.saveScene(sceneId, patch))
    );

    // Re-queue any failed scene beneath edits that arrived while saving (newer
    // typing wins), so a transient failure retries instead of losing the edit.
    const failed = saves.filter((_, i) => results[i].status === "rejected");
    if (failed.length > 0) {
      for (const [sceneId, patch] of failed) {
        const newer = pendingSaves.current.get(sceneId);
        pendingSaves.current.set(sceneId, { ...patch, ...newer });
      }
      setSaveStatus("error");
      scheduleSave(); // retry on the normal cadence
      return;
    }

    setSections((prev) => {
      const wc = wordCountAll(prev);
      if (book) {
        setUnlocks((currentUnlocks) => {
          db.updateBookWordCount(book.id, wc, currentUnlocks).then((updated) =>
            setUnlocks(updated)
          );
          return currentUnlocks;
        });
      }
      return prev;
    });

    setSaveStatus("saved");
    setTimeout(() => setSaveStatus("idle"), 2000);
  }, [book, scheduleSave]);

  flushSavesRef.current = flushSaves;

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
      // Best-effort on unmount/hide — can't re-queue after we're gone, so just
      // swallow failures (the debounce keeps the unsaved window small anyway).
      saves.forEach(([sceneId, patch]) => db.saveScene(sceneId, patch).catch(() => {}));
    }
    if (pendingNoteSaves.current.size > 0) {
      pendingNoteSaves.current.forEach((update, noteId) =>
        db.updateNote(noteId, update).catch(() => {})
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
      setSections((prev) =>
        mapChapter(prev, chapterId, (c) => ({
          ...c,
          scenes: c.scenes.map((s) => (s.id === sceneId ? { ...s, ...patch } : s)),
        }))
      );
      const existing = pendingSaves.current.get(sceneId) ?? {};
      pendingSaves.current.set(sceneId, { ...existing, ...patch });
      scheduleSave();
    },
    [scheduleSave]
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
      const existing = pendingNoteSaves.current.get(noteId) ?? {};
      pendingNoteSaves.current.set(noteId, { ...existing, ...patch });
      const existingTimer = noteTimers.current.get(noteId);
      if (existingTimer) clearTimeout(existingTimer);
      noteTimers.current.set(
        noteId,
        setTimeout(() => {
          const update = pendingNoteSaves.current.get(noteId);
          noteTimers.current.delete(noteId);
          if (!update) return;
          pendingNoteSaves.current.delete(noteId);
          // On failure, restore beneath any newer edit so the note isn't lost;
          // it retries on the next keystroke or the unmount/hide flush.
          db.updateNote(noteId, update).catch(() => {
            const newer = pendingNoteSaves.current.get(noteId);
            pendingNoteSaves.current.set(noteId, { ...update, ...newer });
          });
        }, 1500)
      );
    },
    []
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
  // Recomputes only when `sections` changes identity; the per-chapter cache
  // then makes that recompute touch just the edited chapter.
  const wordCount = useMemo(() => wordCountAll(sections), [sections]);

  return {
    book,
    hydrated,
    saveStatus,
    activeChapter,
    activeChapterLoaded,
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
    reorderScenes,
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
