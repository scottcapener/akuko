"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "./supabase/client";
import * as db from "./db";
import { Book, Chapter, Scene, LibraryImage, LibraryNote, LibraryMusicLink } from "./types";

export type SaveStatus = "idle" | "saving" | "saved";

const AUTOSAVE_DELAY = 30_000;
const UNLOCK_THRESHOLDS = [1000, 2000, 5000, 10000, 25000];

function wordCountAll(chapters: Chapter[]): number {
  return chapters.reduce(
    (total, ch) =>
      total +
      ch.scenes.reduce(
        (s, sc) => s + sc.body.trim().split(/\s+/).filter(Boolean).length,
        0
      ),
    0
  );
}

export function useHotCocoaDb() {
  const [userId, setUserId] = useState<string | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [hydrated, setHydrated] = useState(false);
  const [unlocks, setUnlocks] = useState<number[]>([]);

  // Pending scene saves: sceneId -> patch
  const pendingSaves = useRef<Map<string, Partial<Scene>>>(new Map());
  // Pending note saves: noteId -> patch
  const pendingNoteSaves = useRef<Map<string, { title?: string; body?: string }>>(new Map());
  const noteTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard against React StrictMode double-invocation creating duplicate books
  const initialized = useRef(false);
  // Tracks chapters whose scenes/library have already been fetched from DB
  const loadedChapterIds = useRef(new Set<string>());

  // ── Bootstrap ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      setUserId(user.id);

      const { book: loadedBook, chapters: loadedChapters } =
        await db.getOrCreateBook(user.id);

      // Fetch scenes for first chapter
      const firstChapter = loadedChapters[0];
      if (firstChapter) {
        const scenes = await db.getScenesForChapter(firstChapter.id);
        loadedChapters[0] = { ...firstChapter, scenes };

        // Fetch library for first chapter
        const library = await db.getLibraryForChapter(firstChapter.id);
        loadedChapters[0] = { ...loadedChapters[0], library };
      }

      if (firstChapter) loadedChapterIds.current.add(firstChapter.id);
      setBook({ ...loadedBook, activeChapterId: loadedChapters[0]?.id ?? "" });
      setChapters(loadedChapters);
      setActiveChapterId(loadedChapters[0]?.id ?? null);
      setHydrated(true);
    });
  }, []);

  // ── Load chapter data on switch ───────────────────────────────────────
  const loadChapter = useCallback(async (chapterId: string) => {
    // Skip if already loaded — prevents stale DB data from overwriting unsaved edits
    if (loadedChapterIds.current.has(chapterId)) return;
    loadedChapterIds.current.add(chapterId);

    const [scenes, library] = await Promise.all([
      db.getScenesForChapter(chapterId),
      db.getLibraryForChapter(chapterId),
    ]);

    setChapters((prev) =>
      prev.map((c) => (c.id === chapterId ? { ...c, scenes, library } : c))
    );
  }, []);

  // ── Autosave flush ─────────────────────────────────────────────────────
  const flushSaves = useCallback(async () => {
    if (pendingSaves.current.size === 0) return;
    setSaveStatus("saving");
    const saves = Array.from(pendingSaves.current.entries());
    pendingSaves.current.clear();

    await Promise.all(saves.map(([sceneId, patch]) => db.saveScene(sceneId, patch)));

    // Recalculate word count
    setChapters((prev) => {
      const wc = wordCountAll(prev);
      if (book) {
        setUnlocks((currentUnlocks) => {
          db.updateBookWordCount(book.id, wc, currentUnlocks).then(
            (updated) => setUnlocks(updated)
          );
          return currentUnlocks;
        });
      }
      return prev;
    });

    setSaveStatus("saved");
    setTimeout(() => setSaveStatus("idle"), 2000);
  }, [book]);

  const scheduleSave = useCallback(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(flushSaves, AUTOSAVE_DELAY);
  }, [flushSaves]);

  // ── Book actions ──────────────────────────────────────────────────────
  const setBookTitle = useCallback(
    (title: string) => {
      setBook((b) => (b ? { ...b, title } : b));
      if (book) db.updateBookTitle(book.id, title);
    },
    [book]
  );

  const setCoverImage = useCallback(
    (dataUrl: string | undefined) => {
      setBook((b) => (b ? { ...b, coverImage: dataUrl } : b));
      if (book) db.updateBookCover(book.id, dataUrl);
    },
    [book]
  );

  const setActiveChapter = useCallback(
    (id: string) => {
      setActiveChapterId(id);
      setBook((b) => (b ? { ...b, activeChapterId: id } : b));
      loadChapter(id);
    },
    [loadChapter]
  );

  // ── Chapter actions ───────────────────────────────────────────────────
  const addChapter = useCallback(async () => {
    if (!book) return;
    const newChapter = await db.createChapter(book.id, chapters.length);
    // Load default scene
    const scenes = await db.getScenesForChapter(newChapter.id);
    const fullChapter = { ...newChapter, scenes };
    loadedChapterIds.current.add(newChapter.id);
    setChapters((prev) => [...prev, fullChapter]);
    setActiveChapterId(newChapter.id);
    setBook((b) => (b ? { ...b, activeChapterId: newChapter.id } : b));
  }, [book, chapters.length]);

  const reorderChapters = useCallback(
    async (fromIndex: number, toIndex: number) => {
      setChapters((prev) => {
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        const reordered = next.map((c, i) => ({ ...c, position: i }));
        db.reorderChapters(reordered.map((c, i) => ({ id: c.id, position: i })));
        return reordered;
      });
    },
    []
  );

  const updateChapterTitle = useCallback((id: string, title: string) => {
    setChapters((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c))
    );
    db.updateChapterTitle(id, title);
  }, []);

  // ── Scene actions ─────────────────────────────────────────────────────
  const updateScene = useCallback(
    (chapterId: string, sceneId: string, patch: Partial<Scene>) => {
      setChapters((prev) =>
        prev.map((c) =>
          c.id !== chapterId
            ? c
            : {
                ...c,
                scenes: c.scenes.map((s) =>
                  s.id === sceneId ? { ...s, ...patch } : s
                ),
              }
        )
      );
      // Queue for autosave
      const existing = pendingSaves.current.get(sceneId) ?? {};
      pendingSaves.current.set(sceneId, { ...existing, ...patch });
      scheduleSave();
    },
    [scheduleSave]
  );

  const addScene = useCallback(async (chapterId: string) => {
    const chapter = chapters.find((c) => c.id === chapterId);
    const position = chapter?.scenes.length ?? 0;
    const newScene = await db.createScene(chapterId, position);
    setChapters((prev) =>
      prev.map((c) =>
        c.id !== chapterId ? c : { ...c, scenes: [...c.scenes, newScene] }
      )
    );
  }, [chapters]);

  // ── Library actions ───────────────────────────────────────────────────
  const addLibraryImage = useCallback(
    async (chapterId: string, img: LibraryImage) => {
      if (!userId) return;
      const chapter = chapters.find((c) => c.id === chapterId);
      const position = chapter?.library.images.length ?? 0;

      // img.dataUrl is a data URL — convert and upload
      const saved = await db.addLibraryImageFromDataUrl(
        chapterId,
        userId,
        img.dataUrl,
        img.name,
        position
      );
      setChapters((prev) =>
        prev.map((c) =>
          c.id !== chapterId
            ? c
            : { ...c, library: { ...c.library, images: [...c.library.images, saved] } }
        )
      );
    },
    [userId, chapters]
  );

  const removeLibraryImage = useCallback(
    async (chapterId: string, imageId: string) => {
      setChapters((prev) =>
        prev.map((c) =>
          c.id !== chapterId
            ? c
            : {
                ...c,
                library: {
                  ...c.library,
                  images: c.library.images.filter((i) => i.id !== imageId),
                },
              }
        )
      );
      await db.removeLibraryItem(imageId);
    },
    []
  );

  const addNote = useCallback(
    async (chapterId: string) => {
      const chapter = chapters.find((c) => c.id === chapterId);
      const position = chapter?.library.notes.length ?? 0;
      const saved = await db.addNote(chapterId, { title: "", body: "" }, position);
      setChapters((prev) =>
        prev.map((c) =>
          c.id !== chapterId
            ? c
            : { ...c, library: { ...c.library, notes: [...c.library.notes, saved] } }
        )
      );
    },
    [chapters]
  );

  const updateNote = useCallback(
    (chapterId: string, noteId: string, patch: { title?: string; body?: string }) => {
      // Optimistic update
      setChapters((prev) =>
        prev.map((c) =>
          c.id !== chapterId
            ? c
            : {
                ...c,
                library: {
                  ...c.library,
                  notes: c.library.notes.map((n) =>
                    n.id === noteId ? { ...n, ...patch } : n
                  ),
                },
              }
        )
      );
      // Debounced DB save — merge patches per note
      const existing = pendingNoteSaves.current.get(noteId) ?? {};
      pendingNoteSaves.current.set(noteId, { ...existing, ...patch });
      const existing_timer = noteTimers.current.get(noteId);
      if (existing_timer) clearTimeout(existing_timer);
      noteTimers.current.set(
        noteId,
        setTimeout(() => {
          const update = pendingNoteSaves.current.get(noteId);
          if (update) {
            db.updateNote(noteId, update);
            pendingNoteSaves.current.delete(noteId);
          }
          noteTimers.current.delete(noteId);
        }, 1500)
      );
    },
    []
  );

  const removeNote = useCallback(
    async (chapterId: string, noteId: string) => {
      setChapters((prev) =>
        prev.map((c) =>
          c.id !== chapterId
            ? c
            : {
                ...c,
                library: {
                  ...c.library,
                  notes: c.library.notes.filter((n) => n.id !== noteId),
                },
              }
        )
      );
      await db.removeLibraryItem(noteId);
    },
    []
  );

  const addMusicLink = useCallback(
    async (chapterId: string, link: LibraryMusicLink) => {
      const chapter = chapters.find((c) => c.id === chapterId);
      const position = chapter?.library.musicLinks.length ?? 0;
      const { id: _id, ...rest } = link;
      const saved = await db.addMusicLink(chapterId, rest, position);
      setChapters((prev) =>
        prev.map((c) =>
          c.id !== chapterId
            ? c
            : {
                ...c,
                library: {
                  ...c.library,
                  musicLinks: [...c.library.musicLinks, saved],
                },
              }
        )
      );
    },
    [chapters]
  );

  const removeMusicLink = useCallback(
    async (chapterId: string, linkId: string) => {
      setChapters((prev) =>
        prev.map((c) =>
          c.id !== chapterId
            ? c
            : {
                ...c,
                library: {
                  ...c.library,
                  musicLinks: c.library.musicLinks.filter((l) => l.id !== linkId),
                },
              }
        )
      );
      await db.removeLibraryItem(linkId);
    },
    []
  );

  const activeChapter = chapters.find((c) => c.id === activeChapterId) ?? chapters[0];
  const wordCount = wordCountAll(chapters);

  return {
    book,
    hydrated,
    saveStatus,
    activeChapter,
    chapters,
    wordCount,
    unlocks,
    setBookTitle,
    setCoverImage,
    setActiveChapter,
    addChapter,
    reorderChapters,
    updateChapterTitle,
    updateScene,
    addScene,
    addLibraryImage,
    removeLibraryImage,
    addNote,
    updateNote,
    removeNote,
    addMusicLink,
    removeMusicLink,
  };
}
