> 📋 **REFERENCE — bug postmortem.** Root-cause writeup for the false
> conflict-resolution modals reported during a long writing session
> (investigated & fixed 2026-08-28). Fix shipped in
> **PR #100** (`scottcapener/akuko`), commit `a2c721f`, in
> [`lib/useHotCocoaDb.ts`](../lib/useHotCocoaDb.ts). Kept for reference: the
> failure mode (a stale optimistic-concurrency base) can resurface anywhere the
> per-scene save base is advanced through async React state, so read this before
> touching the autosave / conflict-detection path.

---

# Conflict modal false-positive — postmortem

## 1. Summary

A user hit the conflict-resolution modal repeatedly during a ~2-hour writing
session, even though there was **no second device and no real conflict**. The
modals were **false self-conflicts**: the app conflicted the user against their
own just-saved version. Choosing a version to keep worked correctly (nothing was
lost) but spawned a spurious `"… (conflicting copy · date)"` scene each time and
interrupted the writing flow.

The root cause was a **stale optimistic-concurrency base**: the per-scene base
timestamp used to detect cross-device edits was advanced through asynchronous
React state while being re-read synchronously, opening a race window during
continuous typing.

**Impact:** interruption + clutter (extra copy scenes). **No data loss** — the
conflict machinery's non-destructive design held; it was firing on a phantom.

## 2. Reported symptoms

| Symptom | Reported detail |
| --- | --- |
| Platform | Windows (HP laptop), Hot Cocoa installed as a **PWA**, single tab, no other browser/tab open |
| Network | Good — router in the room, Wi-Fi |
| Timing | Fine the day before, lots of issues yesterday, fine again today — **intermittent** |
| Conflict content | The "conflict" was only ever **a couple of words** |
| Spread | **Many chapters**, not one specific chapter |
| Offline label | User **never saw the "offline" indicator** at any point |
| Resolution behavior | Keeping a version added the conflicting version as a new scene |

## 3. How conflict detection is supposed to work

Hot Cocoa uses **per-scene last-write-wins with stale-write detection** (no CRDTs —
see [`OFFLINE.md`](../OFFLINE.md) §4). Every scene carries the server
`updated_at` it was last derived from as an optimistic-concurrency **base**. On
save, the write is conditional:

```ts
// lib/db.ts — saveScene()
.update({ ...patch })
.eq("id", sceneId)
.eq("updated_at", baseUpdatedAt)   // only writes if the row hasn't moved
```

If zero rows match, the row changed under us → return `conflict` (with the current
server row) instead of clobbering, and the UI raises `ConflictModal`.

The server side is deterministic: the `scenes_updated_at` trigger sets
`new.updated_at = now()` on every update
([`supabase/migrations/001_initial_schema.sql`](../supabase/migrations/001_initial_schema.sql)),
at microsecond precision, round-tripped exactly. **So a spurious conflict can only
mean the client sent a stale base** — it conditioned the write on an
`updated_at` older than what it had itself already written. That is a
self-conflict.

## 4. Root cause

The concurrency base was **advanced through React state (async) but read and
re-captured synchronously**, and additionally persisted to IndexedDB
fire-and-forget. Two async races resulted, sharing one root.

### 4a. The primary race — mid-typing flush vs. state commit

1. During **continuous** typing, `AUTOSAVE_MAX_WAIT` (10s) forces a flush **while
   the user is still typing** — not only after a 2s pause
   (`AUTOSAVE_DELAY`). A focused writer trips this hundreds of times an hour.
2. A forced flush saves the scene, gets back the new timestamp `T1`, and
   **synchronously clears the base** (`pendingBases.delete(sceneId)`), then
   *schedules* `setSections` to write `T1` into scene state — which commits
   **later**, on the next React render.
3. A keystroke landing **after** the clear but **before** that commit runs
   `updateScene`, finds no base, and re-captures it from `sectionsRef.current`,
   which still holds the **old** `T0`. Stale base `T0` is now armed.
4. Next flush: `saveScene(scene, patch, T0)` while the server is at `T1` →
   **conflict** against the user's own prior save. The false delta is just what
   was typed inside the window (→ "only a couple of words").

The window is essentially closed on a fast machine (React commits before the next
input event) but **opens on slower devices and larger books**, where renders are
heavier and concurrent-mode time-slicing can process input mid-render.

### 4b. The secondary race — durable queue resurrection

Every keystroke also mirrors the edit to IndexedDB via a fire-and-forget
`enqueueSceneWrite`, which **keeps the base from the first queued edit of the
cycle** (`existing?.baseUpdatedAt ?? …`). A successful save removes the durable
row via a separate fire-and-forget `removeSceneWrites`. These two IDB operations
are **unordered**, so a late `enqueue` can re-create a row carrying a now-stale
base after the save that removed it. A later focus / `online` **recovery**
(`recoverAndFlush`) then replays that row against an outdated base → conflict.

## 5. Why it matched every symptom

| Symptom | Explanation |
| --- | --- |
| Intermittent, bad one day only | Sub-render-commit timing race; depends on writing rhythm (continuous typing hits the 10s forced flush; bursty typing with >2s pauses rarely does), machine load, and document size |
| HP laptop / long session | Slower renders + larger scene tree widen the window |
| "Only a couple words" | The false-conflict delta is only what was typed inside the window |
| Many chapters | Not chapter-specific — any actively-typed scene |
| Never saw "offline" | Fully online the whole time; `navigator.onLine` was true. It's a race, not an offline event |
| Keeping a version spawned a scene | Expected non-destructive resolve behavior: the losing copy is preserved as a `"… (conflicting copy · date)"` scene |
| No data loss | The safety net worked — it just fired on a phantom |

## 6. The fix

Advance the base **synchronously**, decoupled from React state. Introduced a
`sceneVersions` ref — a `Map<sceneId, updatedAt>` recording the server timestamp
this client last wrote per scene:

- **Advanced synchronously on every clean save** — in the main flush, both
  conflict-resolve branches (keep-mine / keep-theirs), and the unmount flush —
  rather than waiting on `setSections` to commit.
- **Read as the base source** in `updateScene` before falling back to scene
  state. This closes the §4a window regardless of render timing; a scene not yet
  saved this session still falls back to its loaded `updatedAt`.
- **Preferred over the durable queue's persisted base on recovery**
  (`recoverAndFlush`), so a resurrected durable row (§4b) can't replay a scene
  against an outdated base for any scene this session has written.
- Kept the map coherent on `deleteScene` (drop the entry).

All changes are in [`lib/useHotCocoaDb.ts`](../lib/useHotCocoaDb.ts). Typecheck
passes.

### Not browser-verified

The race needs live auth + Supabase + sub-render timing, which a dev preview
can't reproduce deterministically. The fix rests on the mechanism analysis and
typecheck, not a live repro.

## 7. Known adjacent issue (out of scope, still latent)

`reorderScenes` / `moveScene` bump the server `updated_at` (any update fires the
trigger) **without advancing local scene state or `sceneVersions`**. So editing a
scene right after dragging it can still condition on a stale base → a
**genuine-looking** conflict. The resolve path's copy step deliberately avoids
renumbering for this reason (see the comment in `resolveConflict`). This
predates the fix above and was not worsened by it. **If users report conflicts
tied to reordering/moving scenes, this is the next thread to pull** — advance the
moved scenes' base after a reorder/move.

## 8. Guardrails for the future

- **Never derive the optimistic-concurrency base from React state read
  synchronously.** Any value advanced via `setState`/`setSections` is only
  visible after commit; a synchronous ref must be the source of truth for the
  base.
- **Remember `AUTOSAVE_MAX_WAIT` forces flushes mid-typing.** Any logic that
  assumes a flush only happens at a typing pause is wrong.
- **Fire-and-forget IDB writes are unordered.** `enqueue` and `remove` on the
  same key can interleave; don't assume a remove "wins" over a concurrent
  enqueue.
- When changing the autosave/conflict path, reason about the window **between a
  save resolving and the next React commit** — that is where this class of bug
  lives.

## 9. References

- Fix: PR #100 (`scottcapener/akuko`), commit `a2c721f`
- Code: [`lib/useHotCocoaDb.ts`](../lib/useHotCocoaDb.ts),
  [`lib/db.ts`](../lib/db.ts) (`saveScene`),
  [`lib/offlineQueue.ts`](../lib/offlineQueue.ts) (`enqueue` / `remove`)
- Design context: [`OFFLINE.md`](../OFFLINE.md) §4 (conflict model), §7 (phasing),
  §8 (durable queue)
- Schema: [`supabase/migrations/001_initial_schema.sql`](../supabase/migrations/001_initial_schema.sql)
  (`set_updated_at` trigger)
