# Offline Editing — Scoping Spec

Status: **Draft / scoping.** No implementation yet. This doc defines what offline
editing means for Hot Cocoa, what's technically feasible on each platform, and a
phased plan. It deliberately does not pin Next.js 16 service-worker APIs — those
get verified against `node_modules/next/dist/docs/` at implementation time.

---

## 1. Goals & non-goals

**Goal (minimum):** An author can keep working on the chapter they already have
open when the network drops, and their edits sync automatically when it returns.
Nothing is ever lost.

**Goal (maximum / "true offline"):** The author can open the app, navigate their
book, and edit — with **zero network** (airplane, car, hike) — and everything
reconciles the next time they're online.

### Primary usage pattern (confirmed with users)

Offline sessions (plane, car, hike) are **predominantly laptop-based**. Phones
are used for quick notes and small edits, usually with connectivity. This shapes
priorities:

- **Laptops are the easy case.** Desktop Chrome/Edge/Firefox are the all-green
  column in §5 — real engines, full service worker, Background Sync, durable
  storage, no 7-day eviction. The hard problems in this spec are almost all
  iOS/WebKit problems, which the primary device sidesteps.
- **iOS true-offline hardening drops off the critical path.** The home-screen
  install push, 7-day-eviction mitigation, and WebKit cold-start work (§5.1)
  become nice-to-have, not required to ship the value users asked for. The
  analysis stays in this doc, but treat iOS as the secondary target.
- **Offline auth (§6) is elevated to core.** A laptop offline for a whole flight
  is a *multi-hour* session; the Supabase access token (default ~1hr) will expire
  mid-session. "Cached session is good enough to keep editing; queued edits
  survive re-login" is the main path, not an edge case.
- **Per-scene conflict detection (§4) is validated.** Users confirmed they write
  offline on the laptop and make quick edits on the phone — the exact cross-device
  pattern that produces stale-write collisions. Phase 2 earns its place.

**Non-goals:**

- **Multi-user / real-time collaboration.** Hot Cocoa is single-author. This is
  the single most important scoping decision because it takes CRDTs off the
  table (see §4).
- **Offline media upload of new large assets** beyond queuing — v1 caches
  existing library images for *reading*; new image uploads queue like any other
  write.
- **Background sync on iOS.** Not technically possible (see §5); explicitly out.

---

## 2. The core reframe

The "minimum" and "maximum" requirements are **not two architectures**. They're
the same write-buffering engine with a different amount of read-data cached
ahead of time. The hard part — buffering local writes and reconciling them on
reconnect — is built **once** and serves both. The minimum is the foundation of
the maximum, not throwaway work.

Three **independent** layers, addable in order:

| Layer | Buys you | Min | Max |
|---|---|:--:|:--:|
| **1. Durable write queue** — IndexedDB-backed pending edits, flush on reconnect | Keep typing offline, never lose work — *while the tab stays open* | ✅ | ✅ |
| **2. Read cache** — scenes/chapters mirrored in IndexedDB; library image blobs cached | Open & navigate content not pre-loaded; images render offline | ➖ | ✅ |
| **3. Service-worker app shell** — cache HTML/JS/CSS | The app *opens at all* after a cold start with no network | ❌ | ✅ (the gate) |

The key mental model: **Layers 1–2 make edits safe and available; Layer 3 makes
the app reachable.** The difference between "editing on a plane with the tab
already open" and a white screen on a hike (phone was asleep, process killed) is
Layer 3.

---

## 3. What we already have

The write side of Layer 1 is ~80% built in `lib/useHotCocoaDb.ts`:

- `pendingSaves` — a `Map<sceneId, Partial<Scene>>` of unflushed edits.
- Debounced autosave with an "oldest edit" cap so continuous typing still flushes.
- **Re-queue-on-failure** (`useHotCocoaDb.ts:208`): a failed scene save is merged
  back under any newer edits and retried.

What's missing for offline: this queue lives **in memory** and dies with the
tab. Phase 1 is essentially "make this queue durable and flush it on `online`."

Data model (shallow, single-author, all RLS'd by `user_id` — see
`supabase/migrations/001_initial_schema.sql`):

```
books → sections → chapters → scenes(body: HTML string)
                            └→ library_items (image/text/music in Supabase Storage)
```

Prose is stored as an **HTML string** (`CenterColumn.tsx:318` writes
`bodyRef.innerHTML` into `scene.body`) from a **custom `contentEditable`
editor** — there is no ProseMirror/Lexical/Slate document model. This fact
drives §4.

---

## 4. Conflict resolution — per-scene LWW, not CRDTs

**Decision: no CRDTs.** Rationale:

- CRDTs (Yjs/Automerge) operate on structured shared types (`Y.Text`,
  `Y.XmlFragment`), **not opaque HTML strings**. Adopting one means replacing the
  custom `contentEditable` model with a CRDT-backed editor — a rewrite of our
  largest component.
- CRDTs solve *concurrent multi-cursor collaboration*. We're single-author. The
  real conflict surface is narrow: **the same user editing the same scene on two
  devices or two tabs.**

**Chosen model: last-write-wins per scene, with stale-write detection.**

- Scenes are already a small granularity, so a conflict's blast radius is one
  scene, not a chapter.
- Every queued edit carries a `base_updated_at` (the `scenes.updated_at` the edit
  was derived from — the column + trigger already exist).
- On flush, the write is conditional: if the server row's `updated_at` is newer
  than `base_updated_at`, the scene changed elsewhere → **don't clobber**; surface
  a *"this scene changed on another device"* choice (keep mine / keep theirs /
  view both) instead of silently overwriting.
- 95% of the time there is no conflict and the write applies cleanly.

Revisit CRDTs only if real-time collaboration lands on the roadmap — and treat
that as an editor-rewrite project, not an offline feature.

---

## 5. Platform feasibility

### The iOS truth: you can't switch your way out of WebKit

Apple requires **every** iOS browser to use WebKit. iOS Chrome, Firefox, and Edge
are Safari's engine reskinned — they inherit all its limits, and they **cannot
install a home-screen PWA** (installability is Safari-only). So steering iOS users
to Chrome/Firefox removes the only durable-offline path.

**The correct iOS guidance is: "Add Hot Cocoa to your Home Screen in Safari."**
That one action is what makes iOS offline real (see §5.1).

### Support matrix

| Capability | Android Chrome | Desktop Chrome/Edge/FF | iOS Safari (home-screen PWA) | iOS Safari (tab) | iOS Chrome/FF |
|---|:--:|:--:|:--:|:--:|:--:|
| Service worker / app shell (L3) | ✅ | ✅ | ✅ | ✅ | ✅ |
| IndexedDB (L1/L2) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Installable PWA / launcher icon | ✅ (WebAPK) | ✅ | ✅ | ❌ | ❌ |
| Durable storage, no auto-eviction | ✅ | ✅ | ✅ (exempt) | ⚠️ 7-day evict | ⚠️ 7-day evict |
| `storage.persist()` reliably granted | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| **Background Sync** (sync after app closed) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Web Push (if we ever want it) | ✅ | ✅ | ✅ (16.4+) | ❌ | ❌ |

Takeaways:

- **Android & desktop are the best case.** Full PWA, Background Sync works — the
  "close the app, it syncs itself" behavior is only real here.
- **iOS is fully offline-capable for our use case** *if the user installs to the
  home screen*, with two hard limits: no Background Sync (foreground sync only)
  and durability requires the install.
- **Don't message "avoid iOS Safari."** Message "install to Home Screen."

### 5.1 iOS "true offline" in detail

Why the home-screen install matters so much on iOS:

1. **7-day storage eviction.** WebKit's tracking prevention evicts script-writable
   storage (IndexedDB, Cache API) after **7 days of no interaction** with a site
   in a normal Safari tab. **Home-screen web apps are exempt.** For a writing app
   someone opens weekly-ish, a tab could silently lose its local cache between
   sessions; an installed app won't. This alone justifies pushing the install.
2. **More reliable persistent storage.** `navigator.storage.persist()` is far more
   likely to be granted to an installed app than a tab.
3. **Cold-start survival.** iOS aggressively kills backgrounded web-app processes.
   Reopening after a flight is a **cold start** — which, with no network, is a
   white screen *unless* a service worker serves the cached shell (Layer 3). On
   iOS, Layer 3 isn't optional for true offline; it's mandatory.

What "true offline" therefore *is* on iOS:

> The installed app cold-opens with no network (SW-served shell), reads book
> content from IndexedDB, lets the author edit freely into the durable write
> queue, and **reconciles the moment the app is next foregrounded with a
> connection.**

What it is **not** on iOS: silent background sync while the app is closed. That's
Chromium-only. For the plane/hike story this is fine — the author reopens Hot
Cocoa afterward and it catches up — but we must design sync to trigger on
**foreground + `online`**, never assume a background event will fire.

### Android, concretely

Android Chrome is the platform where we can lean in:

- Installable via WebAPK → real launcher icon, own storage sandbox, durable
  storage readily granted, no 7-day eviction pressure.
- **Background Sync API** lets a queued flush complete after the tab/app is
  backgrounded, once connectivity returns.
- Treat Background Sync as **progressive enhancement**: use it where present, but
  the foreground-sync path (built for iOS) is the baseline everywhere so behavior
  is uniform and testable.

---

## 6. Supabase-specific gaps

1. **No offline sync layer.** Supabase gives us Postgres + a client; there's no
   built-in local mirror. For a single-author app, hand-rolling on top of the
   existing queue (§3) is cheaper than adopting a sync engine. If we ever outgrow
   it, **PowerSync** or **ElectricSQL** do real Postgres↔local sync with Supabase
   — file under "later," not v1.
2. **Auth expires offline.** The Supabase access token is short-lived and can't be
   refreshed with no network, yet `/write` gates on a session. Requirements:
   - A **cached session is "good enough" to keep editing locally**; a live token
     is required only to *sync*.
   - Handle the long-offline case where even the refresh token has expired: force
     re-login, but **local queued edits must survive the re-login** (keyed by user
     id in IndexedDB, reattached after re-auth).
   - On reconnect, flush uses the freshly refreshed token so RLS passes normally.

---

## 7. Phasing

Each phase ships value on its own.

1. **Durable write queue (min).** ✅ **Implemented** — `lib/offlineQueue.ts` (raw
   IndexedDB queue + Web Locks + BroadcastChannel) mirrors every **scene and
   note** edit (two stores: `pending_scene_writes`, `pending_note_writes`);
   `useHotCocoaDb.ts` replays them on reconnect/focus/reload and skips flushing
   while offline, showing a calm "Offline — will sync" status instead of an
   error. Delivers "keep writing on the plane, nothing lost" with no service
   worker and no CRDT. See §8. Hardening: `navigator.storage.persist()` is
   requested on init so the queue/cache aren't evicted under storage pressure,
   and the flush is single-flight so a recovery-triggered flush can't race and
   produce a spurious self-conflict.
2. **Per-scene conflict detection.** ✅ **Implemented** — every scene carries its
   server `updatedAt` as an optimistic-concurrency base (`Scene.updatedAt`,
   threaded through the durable queue). `db.saveScene` does a conditional update
   (`.eq("updated_at", base)`) returning `saved` / `conflict` / `deleted`; a
   conflict surfaces `ConflictModal` (keep this device / keep other device)
   instead of clobbering. Multi-device edits prompt instead of overwrite (§4).
3. **Read cache.** ✅ **Implemented (Layer 2 complete).** `lib/offlineDb.ts` is
   the shared IndexedDB handle (v5); `lib/offlineCache.ts` mirrors the book
   structure + each chapter's scenes/library on every successful online load, and
   caches the **blobs** behind stored library images + the book cover (keyed by
   storage path) — serving them as local object URLs when offline, since the
   signed URLs 404 without a connection. `useHotCocoaDb` bootstrap hydrates
   entirely from cache when offline (via cached session `userId`), and
   `loadChapter` falls back to cache. **Text is eager, images are on-visit**: a
   background prefetch warms *every* chapter's text (cheap — whole book readable
   offline + instant chapter switching), while image blobs download only for the
   chapter actually being viewed (via an active-chapter effect), keeping Supabase
   egress bounded rather than pulling every chapter's images up front. The cache
   **persists across sessions**. The image blob cache is LRU-capped
   (`IMAGE_CACHE_MAX`, evicted oldest-first via a `lastUsed` index) so it can't
   grow unbounded and hasten eviction of the whole DB. Images stored as an
   external `url` (no storage path) stay network-dependent; the secondary
   compare-pane caches images only once its chapter becomes active.
4. **Service-worker app shell (max).** ✅ **Implemented.** `public/sw.js` (hand-
   written — Serwist needs webpack, we're on Turbopack) caches the static `/write`
   shell + Next's hashed assets: network-first for navigations (fresh when online,
   cached shell when not), cache-first for immutable assets. Supabase, `/api/*`,
   and non-GET requests are **never cached** — they pass through and fail cleanly
   offline, as the app expects. `ServiceWorkerRegistrar` registers it **production
   only** (a SW fights Turbopack/HMR in dev). Manifest `start_url` is `/write`
   (`/` is a server redirect that can't run offline); the `/write` route guard now
   skips its `getUser()` redirect when offline so the cached shell can hydrate;
   `InstallHint` gives iOS users the "Add to Home Screen" nudge. Turns "plane, tab
   open" into "hike, phone was asleep." Verified with a real `next build`/`start`:
   SW caches the shell, and with the origin server **stopped** the app still
   cold-loads /write and renders. *(SW registration approach checked against the
   Next.js 16 PWA guide.)*
5. **(Optional, later)** Sync engine (PowerSync/Electric) or CRDT — only if
   multi-device load or collaboration materializes.

---

## 8. Phase 1 technical sketch

The near-term, concrete piece. Turns the in-memory queue durable.

**IndexedDB store** (via the `idb` helper or raw IDB — decide at build):

```
DB: hotcocoa-offline
  store: pending_writes   (keyPath: sceneId)
    { sceneId, userId, patch: Partial<Scene>, baseUpdatedAt, queuedAt }
  store: meta
    { key: 'lastFlushAt', ... }
```

Keyed by `sceneId` so repeated edits to the same scene coalesce (same collapse
behavior the in-memory `Map` gives today). Tagged with `userId` so queued work
survives a re-login and never crosses accounts.

**Write path (edit):**

1. `onSceneChange` updates React state (unchanged) **and** writes the patch to
   `pending_writes` (upsert, merging with any existing patch for that scene).
2. Debounced flush fires as today.

**Flush path:**

1. If `navigator.onLine` is false → no-op, leave the queue.
2. Read all `pending_writes` for the current user.
3. For each: conditional update guarded by `baseUpdatedAt` (§4). On success,
   delete the row. On conflict, mark it and raise the UI prompt. On network
   error, leave it queued.
4. Re-run flush on: the `online` event, `visibilitychange`→visible, and app
   mount.

**Notably NOT in Phase 1:** service worker, read cache, CRDT. Phase 1 assumes the
tab/app is already open (its JS is in memory); it only guarantees edits are
*durable and eventually synced*. That's the whole minimum requirement.

**Multi-tab coordination (desktop-relevant).** Laptop users routinely have the
app open in two tabs, which share one origin IndexedDB queue. Two tabs flushing
concurrently can race or double-write. Mitigation:

- **Web Locks API** (`navigator.locks.request`) to elect a single flusher at a
  time across tabs.
- **BroadcastChannel** to notify other tabs after a successful flush so their
  in-memory state stays coherent.

Phones rarely hit this, so it's a laptop-driven requirement — fold it into Phase 1
since the queue is introduced there.

**Open questions for Phase 1:**

- Word-count recompute (`updateBookWordCount`) currently rides the flush — does it
  need the same conditional guard, or is LWW on the aggregate fine? (Likely fine.)
- Library-image *reads* inside an open chapter use signed Storage URLs that
  expire — offline they'll 404. Acceptable for Phase 1 (text-only offline), fixed
  in Phase 3.
