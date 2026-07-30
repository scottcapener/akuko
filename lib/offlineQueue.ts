"use client";

// Durable, cross-tab write queue backing the autosave loop — Phase 1 of offline
// editing (see OFFLINE.md). Scene and note edits are mirrored here the moment
// they're typed, so a tab that closes or loses connectivity mid-edit can replay
// them on reopen / reconnect. The in-memory Maps in useHotCocoaDb stay the
// primary debounce accumulators; this is the durable shadow beneath them.
//
// Deliberately conflict-free: last-write-wins, no base-version guard yet.
// Per-scene conflict detection is Phase 2.

import { Scene } from "./types";

export type ScenePatch = Partial<Pick<Scene, "label" | "body">>;
export type NotePatch = { title?: string; body?: string };

interface PendingWrite<P> {
  userId: string; // so queued work survives re-login and never crosses accounts
  patch: P;
  queuedAt: number;
  // Optimistic-concurrency base captured when the edit was first queued (scenes
  // only). Carried through so a replay after a page reload conditions its save
  // on the version the edit was actually derived from — not whatever the reload
  // fetched. Null for notes / brand-new scenes.
  baseUpdatedAt?: string | null;
}

const DB_NAME = "hotcocoa-offline";
const DB_VERSION = 2;
const SCENE_STORE = "pending_scene_writes";
const NOTE_STORE = "pending_note_writes";
// Each store keys on its entity id (sceneId / noteId) so repeated edits coalesce.
const SCENE_KEY = "sceneId";
const NOTE_KEY = "noteId";

// ── IndexedDB plumbing ──────────────────────────────────────────────────────
// Every entry point degrades gracefully: if IndexedDB is unavailable or blocked
// (private mode, storage disabled), openDb resolves null and the durable layer
// becomes a no-op — the in-memory autosave loop still works exactly as before.

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // v1 → v2 adds the note store; createObjectStore is guarded so an existing
      // scene store (and its queued edits) is left untouched across the upgrade.
      if (!db.objectStoreNames.contains(SCENE_STORE)) {
        db.createObjectStore(SCENE_STORE, { keyPath: SCENE_KEY });
      }
      if (!db.objectStoreNames.contains(NOTE_STORE)) {
        db.createObjectStore(NOTE_STORE, { keyPath: NOTE_KEY });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

function objectStore(db: IDBDatabase, name: string, mode: IDBTransactionMode) {
  return db.transaction(name, mode).objectStore(name);
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Merge a patch into a store, coalescing with any patch already queued for that
// id (newer fields win) — mirrors the in-memory Map collapse. get + put run
// inside one live transaction (put is issued from get's callback) so a rapid
// burst of keystrokes can't lose a field to an interleaved read.
function enqueue<P extends object>(
  storeName: string,
  keyField: string,
  userId: string,
  id: string,
  patch: P,
  baseUpdatedAt?: string | null
): Promise<void> {
  return openDb()
    .then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          if (!db) return resolve();
          const os = objectStore(db, storeName, "readwrite");
          const getReq = os.get(id);
          getReq.onsuccess = () => {
            const existing = getReq.result as (PendingWrite<P> & Record<string, unknown>) | undefined;
            const merged = {
              [keyField]: id,
              userId,
              patch: { ...(existing?.patch ?? {}), ...patch },
              queuedAt: existing?.queuedAt ?? Date.now(),
              // Keep the base from the first queued edit — later keystrokes share
              // the same base until a save advances it.
              baseUpdatedAt: existing?.baseUpdatedAt ?? baseUpdatedAt ?? null,
            };
            const putReq = os.put(merged);
            putReq.onsuccess = () => resolve();
            putReq.onerror = () => reject(putReq.error);
          };
          getReq.onerror = () => reject(getReq.error);
        })
    )
    .then(() => notifyChange());
}

async function remove(storeName: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  if (!db) return;
  const os = objectStore(db, storeName, "readwrite");
  await Promise.all(ids.map((id) => promisify(os.delete(id))));
}

async function read<P>(
  storeName: string,
  keyField: string,
  userId: string
): Promise<{ id: string; patch: P; baseUpdatedAt: string | null }[]> {
  const db = await openDb();
  if (!db) return [];
  const os = objectStore(db, storeName, "readonly");
  const all = (await promisify(os.getAll())) as (PendingWrite<P> & Record<string, string>)[];
  return all
    .filter((w) => w.userId === userId)
    .map((w) => ({ id: w[keyField], patch: w.patch, baseUpdatedAt: w.baseUpdatedAt ?? null }));
}

// ── Public API: scenes ──────────────────────────────────────────────────────

export function enqueueSceneWrite(
  userId: string,
  sceneId: string,
  patch: Partial<Scene>,
  baseUpdatedAt?: string | null
): Promise<void> {
  const durable: ScenePatch = {};
  if (patch.label !== undefined) durable.label = patch.label;
  if (patch.body !== undefined) durable.body = patch.body;
  if (durable.label === undefined && durable.body === undefined) return Promise.resolve();
  return enqueue(SCENE_STORE, SCENE_KEY, userId, sceneId, durable, baseUpdatedAt);
}

export function removeSceneWrites(sceneIds: string[]): Promise<void> {
  return remove(SCENE_STORE, sceneIds);
}

export function readSceneWrites(
  userId: string
): Promise<{ id: string; patch: ScenePatch; baseUpdatedAt: string | null }[]> {
  return read<ScenePatch>(SCENE_STORE, SCENE_KEY, userId);
}

// ── Public API: notes ───────────────────────────────────────────────────────

export function enqueueNoteWrite(userId: string, noteId: string, patch: NotePatch): Promise<void> {
  const durable: NotePatch = {};
  if (patch.title !== undefined) durable.title = patch.title;
  if (patch.body !== undefined) durable.body = patch.body;
  if (durable.title === undefined && durable.body === undefined) return Promise.resolve();
  return enqueue(NOTE_STORE, NOTE_KEY, userId, noteId, durable);
}

export function removeNoteWrites(noteIds: string[]): Promise<void> {
  return remove(NOTE_STORE, noteIds);
}

export function readNoteWrites(userId: string): Promise<{ id: string; patch: NotePatch }[]> {
  return read<NotePatch>(NOTE_STORE, NOTE_KEY, userId);
}

// ── Cross-tab coordination ──────────────────────────────────────────────────
// Laptop users routinely have the app open in two tabs sharing one origin queue.
// Web Locks elects a single flusher so two tabs can't race the same write; the
// BroadcastChannel wakes other tabs when the queue changes so a foregrounded tab
// picks up a background tab's edits. Both degrade to no-ops where unsupported
// (older Safari) — a rare double-write is harmless under last-write-wins.

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) channel = new BroadcastChannel("hotcocoa-offline-queue");
  return channel;
}

function notifyChange() {
  getChannel()?.postMessage({ type: "queue-changed" });
}

export function subscribeQueue(cb: () => void): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const handler = (e: MessageEvent) => {
    if (e.data?.type === "queue-changed") cb();
  };
  ch.addEventListener("message", handler);
  return () => ch.removeEventListener("message", handler);
}

// Run `fn` with an exclusive cross-tab lock so only one tab drains the queue at
// a time. Falls back to running directly where the Web Locks API is absent.
export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as unknown as { locks?: LockManager }).locks;
  if (!locks?.request) return fn();
  return locks.request("hotcocoa-flush", fn) as Promise<T>;
}
