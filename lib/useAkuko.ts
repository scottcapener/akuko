"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Book, Chapter, Scene, LibraryImage, LibraryFile, LibraryMusicLink } from "./types";

const STORAGE_KEY = "akuko_book";
const AUTOSAVE_DELAY = 30_000;

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function defaultScene(): Scene {
  return { id: makeId(), label: "", body: "" };
}

function defaultChapter(n: number): Chapter {
  return {
    id: makeId(),
    title: `Chapter ${n}`,
    scenes: [defaultScene()],
    library: { images: [], files: [], musicLinks: [] },
  };
}

function defaultBook(): Book {
  const ch = defaultChapter(1);
  return {
    id: makeId(),
    title: "Untitled Book",
    coverColor: "#2a2a2c",
    chapters: [ch],
    activeChapterId: ch.id,
  };
}

function loadBook(): Book {
  if (typeof window === "undefined") return defaultBook();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Book;
  } catch {}
  return defaultBook();
}

export type SaveStatus = "idle" | "saving" | "saved";

export function useAkuko() {
  const [book, setBook] = useState<Book>(defaultBook);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setBook(loadBook());
    setHydrated(true);
  }, []);

  const persist = useCallback((next: Book) => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      setSaveStatus("saving");
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    }, AUTOSAVE_DELAY);
  }, []);

  const updateBook = useCallback(
    (updater: (b: Book) => Book) => {
      setBook((prev) => {
        const next = updater(prev);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  // ── Book ───────────────────────────────────────────────────
  const setBookTitle = useCallback(
    (title: string) => updateBook((b) => ({ ...b, title })),
    [updateBook]
  );

  const setActiveChapter = useCallback(
    (id: string) => updateBook((b) => ({ ...b, activeChapterId: id })),
    [updateBook]
  );

  // ── Chapters ───────────────────────────────────────────────
  const addChapter = useCallback(() => {
    updateBook((b) => {
      const ch = defaultChapter(b.chapters.length + 1);
      return { ...b, chapters: [...b.chapters, ch], activeChapterId: ch.id };
    });
  }, [updateBook]);

  const reorderChapters = useCallback(
    (fromIndex: number, toIndex: number) => {
      updateBook((b) => {
        const chs = [...b.chapters];
        const [moved] = chs.splice(fromIndex, 1);
        chs.splice(toIndex, 0, moved);
        return { ...b, chapters: chs };
      });
    },
    [updateBook]
  );

  const updateChapterTitle = useCallback(
    (id: string, title: string) => {
      updateBook((b) => ({
        ...b,
        chapters: b.chapters.map((c) => (c.id === id ? { ...c, title } : c)),
      }));
    },
    [updateBook]
  );

  // ── Scenes ─────────────────────────────────────────────────
  const updateScene = useCallback(
    (chapterId: string, sceneId: string, patch: Partial<Scene>) => {
      updateBook((b) => ({
        ...b,
        chapters: b.chapters.map((c) =>
          c.id !== chapterId
            ? c
            : {
                ...c,
                scenes: c.scenes.map((s) =>
                  s.id === sceneId ? { ...s, ...patch } : s
                ),
              }
        ),
      }));
    },
    [updateBook]
  );

  const addScene = useCallback(
    (chapterId: string) => {
      updateBook((b) => ({
        ...b,
        chapters: b.chapters.map((c) =>
          c.id !== chapterId
            ? c
            : { ...c, scenes: [...c.scenes, defaultScene()] }
        ),
      }));
    },
    [updateBook]
  );

  // ── Library ────────────────────────────────────────────────
  const addLibraryImage = useCallback(
    (chapterId: string, img: LibraryImage) => {
      updateBook((b) => ({
        ...b,
        chapters: b.chapters.map((c) =>
          c.id !== chapterId
            ? c
            : { ...c, library: { ...c.library, images: [...c.library.images, img] } }
        ),
      }));
    },
    [updateBook]
  );

  const removeLibraryImage = useCallback(
    (chapterId: string, imageId: string) => {
      updateBook((b) => ({
        ...b,
        chapters: b.chapters.map((c) =>
          c.id !== chapterId
            ? c
            : {
                ...c,
                library: {
                  ...c.library,
                  images: c.library.images.filter((i) => i.id !== imageId),
                },
              }
        ),
      }));
    },
    [updateBook]
  );

  const addLibraryFile = useCallback(
    (chapterId: string, file: LibraryFile) => {
      updateBook((b) => ({
        ...b,
        chapters: b.chapters.map((c) =>
          c.id !== chapterId
            ? c
            : { ...c, library: { ...c.library, files: [...c.library.files, file] } }
        ),
      }));
    },
    [updateBook]
  );

  const removeLibraryFile = useCallback(
    (chapterId: string, fileId: string) => {
      updateBook((b) => ({
        ...b,
        chapters: b.chapters.map((c) =>
          c.id !== chapterId
            ? c
            : {
                ...c,
                library: {
                  ...c.library,
                  files: c.library.files.filter((f) => f.id !== fileId),
                },
              }
        ),
      }));
    },
    [updateBook]
  );

  const addMusicLink = useCallback(
    (chapterId: string, link: LibraryMusicLink) => {
      updateBook((b) => ({
        ...b,
        chapters: b.chapters.map((c) =>
          c.id !== chapterId
            ? c
            : {
                ...c,
                library: {
                  ...c.library,
                  musicLinks: [...c.library.musicLinks, link],
                },
              }
        ),
      }));
    },
    [updateBook]
  );

  const removeMusicLink = useCallback(
    (chapterId: string, linkId: string) => {
      updateBook((b) => ({
        ...b,
        chapters: b.chapters.map((c) =>
          c.id !== chapterId
            ? c
            : {
                ...c,
                library: {
                  ...c.library,
                  musicLinks: c.library.musicLinks.filter((l) => l.id !== linkId),
                },
              }
        ),
      }));
    },
    [updateBook]
  );

  const wordCount = book.chapters.reduce(
    (total, ch) =>
      total +
      ch.scenes.reduce((s, sc) => {
        const words = sc.body.trim().split(/\s+/).filter(Boolean).length;
        return s + words;
      }, 0),
    0
  );

  const activeChapter =
    book.chapters.find((c) => c.id === book.activeChapterId) ??
    book.chapters[0];

  return {
    book,
    hydrated,
    saveStatus,
    activeChapter,
    wordCount,
    setBookTitle,
    setActiveChapter,
    addChapter,
    reorderChapters,
    updateChapterTitle,
    updateScene,
    addScene,
    addLibraryImage,
    removeLibraryImage,
    addLibraryFile,
    removeLibraryFile,
    addMusicLink,
    removeMusicLink,
  };
}
