"use client";

// Shared IndexedDB handle for all offline features (see OFFLINE.md). Both the
// durable write queue (offlineQueue) and the read-through content cache
// (offlineCache) live in one database, so the version and every object store are
// declared here in one place — opening the same DB at two versions from two
// modules would race the upgrade.

export const DB_NAME = "hotcocoa-offline";
// v1: scene queue · v2: + note queue · v3: + read cache (book / chapter / meta)
// v4: + image blob cache · v5: + image `lastUsed` index (LRU eviction)
const DB_VERSION = 5;

export const IMAGE_LAST_USED_INDEX = "lastUsed";

// Write-queue stores (offlineQueue).
export const SCENE_STORE = "pending_scene_writes";
export const NOTE_STORE = "pending_note_writes";
export const SCENE_KEY = "sceneId";
export const NOTE_KEY = "noteId";

// Read-cache stores (offlineCache).
export const CACHE_BOOK_STORE = "cache_book"; // keyPath: bookId
export const CACHE_CHAPTER_STORE = "cache_chapter"; // keyPath: chapterId
export const CACHE_META_STORE = "cache_meta"; // keyPath: key
export const CACHE_IMAGE_STORE = "cache_image"; // keyPath: path — storage blobs

let dbPromise: Promise<IDBDatabase | null> | null = null;

// Resolves null when IndexedDB is unavailable or blocked (private mode, storage
// disabled) so every caller can degrade to a no-op instead of throwing.
export function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Each guarded so an upgrade from any prior version leaves existing stores
      // (and their data) untouched.
      if (!db.objectStoreNames.contains(SCENE_STORE)) db.createObjectStore(SCENE_STORE, { keyPath: SCENE_KEY });
      if (!db.objectStoreNames.contains(NOTE_STORE)) db.createObjectStore(NOTE_STORE, { keyPath: NOTE_KEY });
      if (!db.objectStoreNames.contains(CACHE_BOOK_STORE)) db.createObjectStore(CACHE_BOOK_STORE, { keyPath: "bookId" });
      if (!db.objectStoreNames.contains(CACHE_CHAPTER_STORE)) db.createObjectStore(CACHE_CHAPTER_STORE, { keyPath: "chapterId" });
      if (!db.objectStoreNames.contains(CACHE_META_STORE)) db.createObjectStore(CACHE_META_STORE, { keyPath: "key" });
      // The image store keeps a `lastUsed` index so LRU eviction can find the
      // oldest blobs without loading every blob into memory. Add the index whether
      // the store is being created now or already exists from a v4 database.
      const imageStore = db.objectStoreNames.contains(CACHE_IMAGE_STORE)
        ? req.transaction!.objectStore(CACHE_IMAGE_STORE)
        : db.createObjectStore(CACHE_IMAGE_STORE, { keyPath: "path" });
      if (!imageStore.indexNames.contains(IMAGE_LAST_USED_INDEX)) {
        imageStore.createIndex(IMAGE_LAST_USED_INDEX, "lastUsed");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

// Ask the browser to mark our storage persistent so the write queue and cache
// aren't silently evicted under storage pressure (the core "nothing lost offline"
// guarantee depends on it — see OFFLINE.md). Best-effort and idempotent: some
// browsers grant it automatically based on engagement/installation, others prompt
// or decline; either way we never throw. Returns whether storage is persisted.
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function objectStore(db: IDBDatabase, name: string, mode: IDBTransactionMode) {
  return db.transaction(name, mode).objectStore(name);
}

export function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
