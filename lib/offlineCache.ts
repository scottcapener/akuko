"use client";

// Read-through content cache — Phase 3 of offline editing (see OFFLINE.md).
// Every successful online load mirrors the book structure and each chapter's
// scenes + library into IndexedDB; when a load fails (offline) the app hydrates
// from this mirror instead of showing an empty/error state. This is what lets an
// author open and navigate their whole book with no network.
//
// Text content only for now: library image `dataUrl`s are time-limited signed
// URLs that 404 offline — caching the underlying blobs is a fast-follow. Cached
// structure/scenes/notes/links all work offline today.

import { Book, Section, Scene, ChapterLibrary } from "./types";
import { openDb, objectStore, promisify, CACHE_BOOK_STORE, CACHE_CHAPTER_STORE, CACHE_META_STORE } from "./offlineDb";

const SESSION_KEY = "session";

interface CachedBook {
  bookId: string;
  userId: string;
  book: Book;
  sections: Section[]; // structure only — chapters carry empty scenes/library
}
interface CachedChapter {
  chapterId: string;
  userId: string;
  scenes: Scene[];
  library: ChapterLibrary;
}
interface CachedSession {
  key: string;
  userId: string;
  bookId: string;
}

const emptyLibrary = (): ChapterLibrary => ({ images: [], notes: [], musicLinks: [], links: [] });

// ── Writes (populate the cache on successful online loads) ───────────────────

// Snapshot the book structure and remember it as the active session, so an
// offline reload knows whose book to reconstruct. Chapter content is stored
// separately via cacheChapter, so the structure is flattened to a skeleton here.
export async function cacheBook(userId: string, book: Book, sections: Section[]): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const skeleton: Section[] = sections.map((s) => ({
    ...s,
    chapters: s.chapters.map((c) => ({ ...c, scenes: [], library: emptyLibrary() })),
  }));
  const tx = db.transaction([CACHE_BOOK_STORE, CACHE_META_STORE], "readwrite");
  tx.objectStore(CACHE_BOOK_STORE).put({ bookId: book.id, userId, book, sections: skeleton } satisfies CachedBook);
  tx.objectStore(CACHE_META_STORE).put({ key: SESSION_KEY, userId, bookId: book.id } satisfies CachedSession);
  await new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function cacheChapter(
  userId: string,
  chapterId: string,
  scenes: Scene[],
  library: ChapterLibrary
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await promisify(
    objectStore(db, CACHE_CHAPTER_STORE, "readwrite").put({
      chapterId,
      userId,
      scenes,
      library,
    } satisfies CachedChapter)
  ).catch(() => {});
}

// ── Reads (offline fallback) ─────────────────────────────────────────────────

export async function readCachedChapter(
  chapterId: string
): Promise<{ scenes: Scene[]; library: ChapterLibrary } | null> {
  const db = await openDb();
  if (!db) return null;
  const row = (await promisify(objectStore(db, CACHE_CHAPTER_STORE, "readonly").get(chapterId)).catch(
    () => undefined
  )) as CachedChapter | undefined;
  return row ? { scenes: row.scenes, library: row.library } : null;
}

// Reconstruct the full editor state from cache for an offline bootstrap: the
// book, its sections with every cached chapter's scenes/library merged in, and
// the set of chapters whose content was actually cached (the rest stay skeletons
// the app can lazy-load once back online).
export async function readSnapshot(): Promise<{
  userId: string;
  book: Book;
  sections: Section[];
  loadedChapterIds: string[];
} | null> {
  const db = await openDb();
  if (!db) return null;

  const session = (await promisify(objectStore(db, CACHE_META_STORE, "readonly").get(SESSION_KEY)).catch(
    () => undefined
  )) as CachedSession | undefined;
  if (!session) return null;

  const cachedBook = (await promisify(objectStore(db, CACHE_BOOK_STORE, "readonly").get(session.bookId)).catch(
    () => undefined
  )) as CachedBook | undefined;
  if (!cachedBook) return null;

  const loadedChapterIds: string[] = [];
  const sections: Section[] = [];
  for (const section of cachedBook.sections) {
    const chapters = [];
    for (const chapter of section.chapters) {
      const content = await readCachedChapter(chapter.id);
      if (content) {
        loadedChapterIds.push(chapter.id);
        chapters.push({ ...chapter, scenes: content.scenes, library: content.library });
      } else {
        chapters.push({ ...chapter, scenes: [], library: emptyLibrary() });
      }
    }
    sections.push({ ...section, chapters });
  }

  return { userId: session.userId, book: cachedBook.book, sections, loadedChapterIds };
}
