> 🪦 **ARCHIVED — superseded by [REALTIME_SYNC.md](../REALTIME_SYNC.md).** This
> spec has been coalesced into the unified Realtime Sync epic (Track A · Manuscript
> Sync). **Part 1 (the `content_edited_at` last-write-wins save) shipped
> 2026-09-06** and lives on as Stage A1. **Part 2 (cross-device pull / A→B→A) was
> never built** and is superseded by the Yjs CRDT stages (A3/A4) rather than
> revived. Kept for the design rationale and the false-positive postmortem trail;
> do not build from this doc — build from REALTIME_SYNC.md. Relative links below are
> as-written from the repo root (pre-archive).

---

# Sunsetting the conflict-resolution modal

**Status:** planned (2026-09-06) · **Decision:** last-edit-wins, automatic, fully
silent, no backup copy

## Scope (confirmed)

1. **Remove the blocking `ConflictModal`** — resolve every conflict automatically.
2. **Fully silent** — no toast, no notice. Mimic Google Docs: it "just works".
3. **Stop creating "(conflicting copy · date)" scenes** — they clutter chapters.
   (Existing copies already in users' books: see *Existing-copy cleanup* — that's
   a separate decision, not auto-deleted here.)
4. **Remove the "already open in another tab" lock** (`useEditorOwnership` +
   `EditorLockedOverlay`) — unnecessary once writes are last-write-wins.
5. **Add cross-device auto-update (pull)** so switching A→B→A refreshes A. This is
   net-new; today the app is push-only. See *Cross-device auto-update*.

Two directions to keep straight:
- **Push** (a device saves): handled by the `content_edited_at` LWW write below.
- **Pull** (a device learns another changed a scene): the new refresh-on-focus.

## Relationship to SHARED_LIVE.md

The two efforts **converge on the same realtime plumbing but aim at different
subjects.** [SHARED_LIVE.md](SHARED_LIVE.md) is live *conversation* (presence +
comments) on **shared** chapters; this is live *manuscript* sync for a **solo
author across their own devices**. What transfers and what doesn't:

| | SHARED_LIVE.md | Scene sunset (Part 2 pull) |
| --- | --- | --- |
| Transport | Supabase Realtime | *same* |
| Model | Postgres change → debounced refetch (not payload) | *same* |
| Channel manager | `lib/shared/liveChannel.ts` + `useSharedLive` | *same pattern, new channel* |
| Keyed on | `shared_chapter_id` (**exists only when shared**) | `book_id`/`chapter_id` (owner, solo) |
| Watches table | `comments` | `scenes` |
| Refresh target | keyed comment cards (reconcile in place) | uncontrolled contentEditable (**Blocker 2**) |

**Reusable now:** the refetch-on-signal model (§2), the ref-counted channel
manager (§3), and the Realtime auth / migration / free-tier answers (§6, §8, §2).
Building SHARED_LIVE Stage 13.1 turns Part 2 from "net-new infrastructure" into
"point the pattern at `scenes`."

**Not covered:** scene content sync at all (it watches `comments`); the push-side
LWW / `content_edited_at` (comments have no write conflict — self-only by RLS);
and the **`shared_chapter_id` mismatch** — that key only exists for shared
chapters, so the solo A→B→A case has no such channel and must key on
`book_id`/`chapter_id`. **Blocker 2 is not solved by Realtime** either: comments
dodge it with keyed cards + array replace (§5); the scene body is one uncontrolled
`contentEditable`, so Realtime only changes *when* the refresh fires (push vs
focus), not *how* new text lands without eating the caret.

**Consequence for the Part 2 choice** (*Cross-device auto-update → Scope*):
focus-refresh ships standalone with no Realtime dependency and fully covers the
stated switch-back flow; a Realtime scene channel reuses SHARED_LIVE's plumbing
and adds live-while-visible sync, but pulls in the Stage 13.1 migration and still
leaves Blocker 2 to solve.

## Why

The blocking `ConflictModal` interrupts writers and, per the postmortem trail
(`archive/CONFLICT_MODAL_FALSE_POSITIVE_POSTMORTEM.md`,
migrations 019/020, PR #100, PR #102), keeps firing on **false** conflicts. Every
recurrence traces to the same fragile mechanism: the per-scene
optimistic-concurrency **base** (`.eq("updated_at", base)` in `saveScene`). The
base is a moving target that goes stale from:

- structural writes bumping `updated_at` without the client learning the value
  (reorder/move — fixed by 020, but the pattern is inherently brittle),
- the base being advanced through async React state but re-read synchronously
  (fixed by the `sceneVersions` ref in PR #100),
- coalesced keystrokes landing across a save boundary.

Instead of hardening the base again, we **remove it**. Single-author app → no
CRDTs, no merge. Goal: **the latest edit of a scene wins, on whichever device it
was made, resolved automatically with no user prompt.**

## Design: `content_edited_at` last-write-wins

Add a client-supplied timestamp `content_edited_at` to `scenes`, set on every
content save = when the author last actually edited the text. This becomes the
concurrency token, replacing the `updated_at` base entirely.

The scene save becomes an atomic server-side LWW write:

```sql
update scenes
   set label = :label, body = :body, content_edited_at = :authoredAt
 where id = :id
   and (content_edited_at is null or content_edited_at < :authoredAt)
returning updated_at, content_edited_at;
```

Outcomes:

| Server result | Meaning | Action |
|---|---|---|
| 1 row returned | our edit is newest | record it, done |
| 0 rows, row exists | server has a **newer** edit | re-read row, adopt it into local state, drop the queued edit |
| 0 rows, row gone | scene deleted elsewhere | drop the queued edit |

No modal, no `SceneConflict`, no backup copy, **no toast** (per decision). A stale
edit is discarded silently and the device adopts the server version — this is the
same reconciliation the pull path does, just triggered by a save attempt instead
of a focus event.

### Why this kills the false-positive class

The guard is **self-contained in each write** — there is no cached base that can
drift. Structural reorders/moves never write `content_edited_at`, so a
drag-then-edit cannot self-conflict. A same-device offline burst has strictly
increasing `authoredAt`, so each replay beats the row it just wrote — no
self-conflict. The `sceneVersions` / `pendingBases` refs become unnecessary.

### `authoredAt` capture

- Captured at edit time (last keystroke of a debounced batch), carried alongside
  the patch through `pendingSaves` **and** the durable IndexedDB queue.
- On coalescing (`enqueue` merge, and the in-memory `pendingSaves` merge), keep
  the **latest** `authoredAt`.
- Clock-skew caveat (important, since there is no backup): `authoredAt` is a
  client clock; the author's two devices are compared against each other. For a
  single author with NTP-synced devices skew is small, but a badly-skewed device
  could bury newer work irrecoverably. Optional hardening (not required for v1):
  learn a per-device offset from server timestamps and correct `authoredAt`
  before sending. Flagged, deferred.

## Cross-device auto-update (pull) — the A→B→A flow

Write on device A, continue on B, switch back to A → A should silently show B's
text. This is **net-new**; the app is push-only today. Three blockers:

**1. No pull mechanism.** On focus/online the hook flushes *its own* pending
writes (`useHotCocoaDb.ts` online/visibility listeners) but never re-fetches
scene content. `loadChapter` dedups already-loaded chapters, so it won't refresh
an open one.
→ Add a **force-refresh** of the active chapter on `visibilitychange`→visible,
`focus`, and `online`. A `loadChapter(id, { force: true })` that bypasses the
`loadedChapters` short-circuit and overwrites in-memory scenes.

**2. The editor ignores external body updates (the hard one).** `SceneBlock`
writes `innerHTML` only on mount / `scene.id` change
(`SceneBlock.tsx` effect, deps `[scene.id]`). Updating React state with B's body
does **not** touch the live `contentEditable` while the scene stays open.
→ Version-gate a re-sync: re-apply `innerHTML` when the incoming
`content_edited_at` is newer than what the editor rendered, **and** the field is
not focused / not dirty (so it never yanks the caret mid-keystroke). Simplest
robust form: include `content_edited_at` in the effect deps and guard on
`document.activeElement !== bodyRef.current` + no pending local edit for the scene.
Re-keying the block on `content_edited_at` also works but drops caret/scroll.

**3. Reconciliation must respect LWW + not clobber active typing.** Only overwrite
A when incoming is newer AND A has no unsynced newer edit for that scene. Since
the author physically switched away, A is idle on return → the safe case; the
guard only matters for the edge where A itself had offline edits (then A wins and
pushes on its own flush).

Structure (scene add/remove/reorder on B) rides along with the chapter refetch, so
it reconciles once the pull exists — subject to the same re-key concern for any
open scene whose id survives.

### Scope: focus-refresh now, Realtime later
The confirmed A→B→A flow only needs refresh on **focus/visibility/online** — the
switch-back *is* the trigger. True always-live sync (A updates while visible,
without switching) needs Supabase Realtime; the plumbing is already drafted in
`SHARED_LIVE.md`. Recommend v1 = focus-refresh (covers the stated flow, far
simpler); Realtime is the follow-up if simultaneous live editing is wanted.

## Removing the single-tab editor lock

`useEditorOwnership` + `EditorLockedOverlay` make one tab the owner and park others
read-only. **This is same-browser only** — Web Locks and BroadcastChannel are
same-origin/same-browser, so it never coordinated across devices A and B; removing
it does not change cross-device behavior. Its only job was preventing two tabs in
one browser from producing save conflicts, which LWW now makes safe.

- **Delete:** `lib/useEditorOwnership.ts`, `components/EditorLockedOverlay.tsx`.
- **`app/write/page.tsx`:** remove the `useEditorOwnership` call and the
  `ownership.status === "readonly"` overlay render (~lines 121, 733–735).
- Two same-browser tabs then both edit freely; the shared durable queue
  (`offlineQueue.runExclusive`, Web Locks) still serializes the actual writes, and
  LWW settles any overlap.

## Existing-copy cleanup (decision needed)

New code stops creating "(conflicting copy · date)" scenes. Copies already in
users' books are **real scenes with real content** — auto-deleting risks
destroying the only copy of some writing. Options, for Scott to pick:
- **Leave them** (safest; clutter persists for existing books only).
- **One-time script** to list/count them per book for manual review.
- **Bulk delete** by label pattern (fastest cleanup; irreversible — not recommended
  without a backup pass first).
Not resolved in this plan; flagged.

## Migration (021)

```sql
alter table scenes add column content_edited_at timestamptz;
update scenes set content_edited_at = updated_at where content_edited_at is null;
alter table scenes alter column content_edited_at set default now();
```

`updated_at` is left untouched: the 019 `scenes_bump_chapter` AFTER trigger and
the shared-chapter "View as reader" freshness check still rely on it. The 020
content-only `set_updated_at` trigger stays. `content_edited_at` is an
independent LWW token written explicitly by the client, not by a trigger.

## Code changes

**`lib/db.ts`**
- `saveScene(sceneId, patch, authoredAt)` — replace the two-step base-conditional
  write + re-read-on-miss with the single `.lt("content_edited_at", authoredAt)`
  guarded write (plus null-guard). Keep the re-read only to distinguish
  stale-vs-deleted on a 0-row result. Return `{status:"saved"|"stale"|"deleted", server?}`.
- Result type `"conflict"` → `"stale"` (carries the server row to adopt).

**`lib/offlineQueue.ts`**
- Replace `baseUpdatedAt` field with `authoredAt` on `PendingWrite` and the scene
  read/enqueue/merge paths (keep latest on merge). DB stays v4 (additive field;
  old rows without it fall back to `now()` on replay).

**`lib/useHotCocoaDb.ts`** (biggest change — mostly deletion)
- Flush loop: replace the `else` conflict branch with the auto-adopt path (apply
  server label/body/updatedAt/content_edited_at to local state; remove durable
  copy; drop pending). No `setConflicts`.
- **Delete:** `SceneConflict`, `conflicts` state + `conflictsRef`,
  `resolveConflict`, `resolvingScenes`, `copiedLoserBody`, `sceneVersions`,
  `pendingBases`, `conflictCopyNotice` + `dismissConflictCopyNotice` (or repurpose
  the notice for the quiet "updated with newer changes" toast).
- Track `authoredAt` per queued edit instead of a base.

**`app/write/page.tsx`**
- Remove the `ConflictModal` render (lines ~724–726) and its imports/props.
- Keep or repurpose `ConflictCopyToast` as the quiet sync notice, or remove.

**Delete:** `components/ConflictModal.tsx`; `ConflictCopyToast.tsx` if the notice
is dropped.

**Notes & chapters:** already last-write-wins (unconditional writes, no base) —
no change needed. Goal's "chapter" edits are covered by existing behavior. (The
pull path should still refresh chapter titles/structure on focus.)

**`lib/useEditorOwnership.ts` + `components/EditorLockedOverlay.tsx`:** deleted —
see *Removing the single-tab editor lock*.

**Pull path (`useHotCocoaDb.ts` + `SceneBlock.tsx`):** add force-refresh of the
active chapter on focus/visibility/online, and version-gated `innerHTML` re-sync
in the editor — see *Cross-device auto-update*.

## Verification (per verify-on-throwaway-content)

Never type into real scenes/notes. Test by injecting synthetic pending writes
with controlled `authoredAt` against **throwaway** scene ids:

1. Older `authoredAt` than server → write is a no-op, local adopts server. No modal.
2. Newer `authoredAt` → server row updated. No modal.
3. Reorder-then-edit a scene → saves cleanly (the original repro). No modal.
4. Two-tab / offline-replay simulation → newest `authoredAt` is the surviving
   body; nothing lost from the winner's side.
5. Confirm `ConflictModal` can no longer mount (component deleted, no references).

## Rollout

1. Ship migration 021 (backfill is safe/idempotent).
2. Ship client change in the same release (client must write `content_edited_at`).
   A client that predates 021 keeps using the base path harmlessly until updated;
   a client that writes `content_edited_at` before 021 exists would error — so
   **migration first, then deploy**.
3. Watch Supabase logs for `stale` adoptions to confirm real cross-device edits
   resolve silently and the false-positive rate goes to zero.
