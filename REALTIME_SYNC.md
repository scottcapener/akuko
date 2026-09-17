# Realtime Sync — the epic

**One epic, two tracks, one transport.** Everything Hot Cocoa does across
devices and across people — keeping a manuscript in sync, and keeping the
conversation around it live — converges on a single **Supabase Realtime** layer.
This document traces how we got here, what has already shipped, and the work
left, unifying three earlier specs:

- `CONFLICT_SUNSET.md` → **Track A** (manuscript sync: the LWW stopgap, now shipped)
- the CRDT/Yjs migration plan → **Track A** (manuscript sync: the robust target)
- `SHARED_LIVE.md` → **Track B** (live conversation: presence + live comments)

> **Supersedes** `CONFLICT_SUNSET.md` and `SHARED_LIVE.md`, both now archived as
> tombstones in [`archive/`](archive/). This is the single source of truth for
> realtime and cross-device work. The canonical *sharing* spec remains
> [SHARED_WITH_YOU.md](SHARED_WITH_YOU.md) / [SHARED_WITH_YOU_UPDATES.md](SHARED_WITH_YOU_UPDATES.md);
> this doc owns the realtime additions and updates that spec's decisions where §9 says so.

Figma: **Hot Cocoa** (`e4DJxj1g7GTcfUpMaMOvVe`) — presence in
[read view 360-3646](https://www.figma.com/design/e4DJxj1g7GTcfUpMaMOvVe/Hot-Cocoa?node-id=360-3646)
and [write view 360-3742](https://www.figma.com/design/e4DJxj1g7GTcfUpMaMOvVe/Hot-Cocoa?node-id=360-3742).

---

## 0. The arc — why the approach shifted

Three eras, one recurring lesson: **the concurrency model has to be self-healing,
because the writer must never be interrupted and must never lose words.**

### Era 1 — Optimistic-concurrency base + blocking modal *(removed)*

The original scene save conditioned on a cached per-scene version base
(`.eq("updated_at", base)` in `saveScene`). On a mismatch it threw a blocking
`ConflictModal`, spawned "(conflicting copy · date)" scenes, and parked non-owner
tabs read-only behind an `EditorLockedOverlay`.

It kept firing on **false** conflicts. The base is a moving target that drifts
stale from structural writes bumping `updated_at` without the client learning the
value, from the base advancing through async React state but being re-read
synchronously, and from coalesced keystrokes landing across a save boundary. Full
root-cause trail in
[archive/CONFLICT_MODAL_FALSE_POSITIVE_POSTMORTEM.md](archive/CONFLICT_MODAL_FALSE_POSITIVE_POSTMORTEM.md)
(migrations 019/020, PR #100, PR #102). Every recurrence traced to the same
fragile mechanism, so instead of hardening the base again, we removed it.

### Era 2 — `content_edited_at` last-write-wins *(shipped — the stopgap)*

A client-supplied timestamp became the concurrency token; the newest edit wins on
whichever device made it, resolved automatically with **no prompt, no toast, no
backup copy**. This killed the false-positive class and unblocked writers. See
**Track A · Stage A1** for the shipped design.

It was always understood as a **stopgap**, and it has three honest limits:

1. **Whole-scene clobber.** LWW resolves at the granularity of an entire scene
   body. Two devices that both edited the *same* scene → the older-timestamped
   side is discarded **wholesale**, not merged. Fine for "latest wins"; lossy for
   "I added a paragraph on my phone and a paragraph on my laptop."
2. **No pull side.** The A→B→A cross-device refresh (`CONFLICT_SUNSET.md` Part 2)
   was specced but **never built**. The app is still push-only; switching back to
   a device shows its stale copy until reload.
3. **Clock-skew risk.** `authoredAt` is a client clock; a badly-skewed device can
   bury newer work irrecoverably (there is no backup copy anymore).

### Era 3 — Yjs CRDT over Realtime broadcast *(the target)*

Replace scene-level LWW with a **per-scene Yjs (CRDT) document** that merges
**character-level** instead of clobbering, synced over the same Supabase Realtime
channel layer Track B needs. This fixes all three Era-2 limits at once: merge (not
clobber), a real pull/merge path, and no reliance on comparing wall clocks. It
also demands a structured editor (TipTap/ProseMirror), which is what finally
solves the open "Blocker 2" (an uncontrolled `contentEditable` can't absorb an
external update without eating the caret). See **Track A · Stages A2–A5**.

**Driver (confirmed):** solo author cross-device sync, robust offline merge, and
durable comment anchoring — **not** two people typing in one scene at once. That
lowers the transport bar: no multi-cursor awareness, no sub-second requirement.
Async merge-on-load already fixes the data loss; live broadcast is an accelerator.

---

## 1. The shared foundation — Supabase Realtime

Both tracks ride **one transport we already own**. The browser client
([lib/supabase/client.ts](lib/supabase/client.ts), `@supabase/supabase-js` 2.106)
ships Presence, Postgres Changes, private-channel Realtime Authorization, and raw
Broadcast. **No new transport, no polling loop, no third-party service, no
Supabase Pro** (Realtime is on the free tier; a private writing-group app sits
under the connection/message limits).

### 1.1 Ref-counted channel manager *(net-new, shared by both tracks)*

Multiple consumers want the same chapter's channel at once — Track B's presence
stack and comment list, and Track A's scene-sync subscriber. Opening a channel per
consumer would double presence entries and connections. So realtime lives behind a
**module-scoped, ref-counted manager**, mirroring the `useUnread.ts`
module-store-plus-subscribers pattern already in the codebase:

```
lib/shared/liveChannel.ts   (new)
  getChannel(topic, { userId, name, avatarUrl }) → handle
    - first caller opens the Supabase channel, tracks presence, subscribes to
      the relevant postgres_changes / broadcast events
    - returns { onPresence(cb), onCommentsChanged(cb), onSceneUpdate(cb),
                broadcastSceneUpdate(bytes), release() }
    - last release() untracks + removes the channel
```

A thin `useSharedLive(topic)` hook wraps acquire/release around component
lifetime. Auth: private channels need the user JWT — call
`supabase.realtime.setAuth(accessToken)` from the current browser session before
subscribe.

### 1.2 Channel keying — the one asymmetry between tracks

| | Track B (live conversation) | Track A (manuscript sync) |
| --- | --- | --- |
| Subject | comments + presence on a **shared** chapter | a **solo author's** scene content |
| Keyed on | `shared_chapter_id` (exists **only when shared**) | `book_id` / `chapter_id` (owner, always) |
| Topic | `shared_chapter:<sharedChapterId>` | `book_chapter:<chapterId>` |
| Watches | `comments` (Postgres Changes) + Presence | Yjs updates (Broadcast) |

The keying difference is load-bearing: the solo A→B→A case has **no**
`shared_chapter_id`, so Track A must key on the owner's `book_id`/`chapter_id`. The
manager takes an opaque topic string so both tracks reuse one implementation.

### 1.3 Auth & schema foundation — migration `022` *(next-available; the old `SHARED_LIVE.md` "018" was stale — 018 is `comment_owner_delete`)*

One migration establishes the realtime substrate both tracks need:

1. **Publish `comments` to Realtime** — add to the `supabase_realtime` publication.
2. **`ALTER TABLE comments REPLICA IDENTITY FULL;`** — so UPDATE/DELETE events
   carry the old row (needed for the per-row RLS check and to know *which* comment
   changed).
3. **Realtime Authorization** — RLS policies on `realtime.messages` (SELECT to
   receive, INSERT to track/broadcast) that authorize when the topic's parsed id
   passes access control. For Track B topics, parse `shared_chapter:<uuid>` and
   check `has_access(shared_chapter_id)` ([SHARED_WITH_YOU.md §2 RLS](SHARED_WITH_YOU.md)).
   For Track A topics, parse `book_chapter:<uuid>` and check the chapter's book is
   owned by `(select auth.uid())`. Follow the InitPlan pattern from migration 009.

Postgres Changes honors the table's **SELECT policy per row per subscriber**, so
comment events reach only users who could read the row; a non-recipient subscribing
to the topic receives nothing. Defense in depth: the comment refetch is
independently RLS-gated (`GET /api/comments` returns null without access).

Per [AGENTS.md](AGENTS.md): this is Next.js 16.2.6 — read the relevant guide in
`node_modules/next/dist/docs/` before adding any route handler.

---

## Track A — Manuscript Sync

*Goal: a writer's words are the same everywhere, merged not clobbered, online or
off, with no prompt and no loss.*

### Stage A1 — `content_edited_at` last-write-wins ✅ *shipped (2026-09-06)*

Preserved here as the record of the current production behavior.

`content_edited_at` is a client-supplied timestamp (when the author last actually
edited the text), and the concurrency token. The save is an atomic server-side LWW
write ([lib/db.ts](lib/db.ts) `saveScene`):

```sql
update scenes
   set label = :label, body = :body, content_edited_at = :authoredAt
 where id = :id
   and (content_edited_at is null or content_edited_at < :authoredAt)
returning updated_at, content_edited_at;
```

| Server result | Meaning | Action |
|---|---|---|
| 1 row returned | our edit is newest | record it, done |
| 0 rows, row exists | server has a **newer** edit | re-read, adopt into local state, drop the queued edit |
| 0 rows, row gone | scene deleted elsewhere | drop the queued edit |

**Why it killed the false-positive class:** the guard is self-contained in each
write — no cached base to drift. Structural reorders/moves never write
`content_edited_at` (migration 020), so a drag-then-edit can't self-conflict. A
same-device offline burst has strictly increasing `authoredAt`, so each replay
beats the row it just wrote.

**`authoredAt` capture:** taken at edit time (last keystroke of a debounced batch),
carried through the in-memory `pendingSaves` **and** the durable IndexedDB queue
([lib/offlineQueue.ts](lib/offlineQueue.ts)); on any coalesce, keep the **latest**.

**Shipped in this stage:** migration 021 (`content_edited_at`, idempotent
backfill); `saveScene` rewrite to the guarded write returning
`saved | stale | deleted`; removal of `ConflictModal`, `SceneConflict`, the
"(conflicting copy · date)" scenes, `ConflictCopyToast`, and the single-tab editor
lock (`useEditorOwnership` + `EditorLockedOverlay`) — all files deleted; durable
cross-tab write queue with Web Locks + BroadcastChannel.

**Deliberately deferred out of A1 (and now superseded by A2–A4 rather than built
as specced):** the Part-2 cross-device *pull* (focus-refresh + version-gated
editor re-sync). It was never shipped; the CRDT path below is the better answer to
the same need, so A1's push-only behavior is the current production state.

### Stage A2 — Editor swap: TipTap/ProseMirror under LWW *(no CRDT yet)*

**The gating risk of the whole track — do it first and in isolation.** Today the
scene body is a raw `contentEditable` div that reads `innerHTML` on every `onInput`
([components/SceneBlock.tsx:272](components/SceneBlock.tsx:272)); the only inline
formatting is `<em>`, paste is coerced to plain text, and there are hard-won iOS
quirks (autofill opt-out so the password/card bar doesn't pop over the keyboard,
`autoCapitalize="sentences"`, IME) plus copy-with-indent
([`indentedParagraphHtml`](components/SceneBlock.tsx:52)) and a custom Cmd+I.

Replace it with a **TipTap/ProseMirror** editor that emits the **exact same HTML**
(paragraph structure + `<em>` only) into `scene.body`, still saved by the existing
A1 LWW path. Nothing downstream changes because the HTML contract is preserved.

- **Why first:** this is ~70% of the track's effort and *all* of its UI risk. Yjs
  does not bind to a raw `contentEditable`; every production binding
  (`y-prosemirror`, `y-quill`, `y-codemirror`) targets a structured model. Proving
  editor parity before adding sync keeps the two risks from compounding.
- **Exit:** desktop + iOS Safari feel identical to today; exports
  ([lib/export/html.ts](lib/export/html.ts)), word count ([lib/words.ts](lib/words.ts)),
  find/replace ([lib/findReplace.ts](lib/findReplace.ts)), sanitize, comments, and
  the read/shared views are byte-compatible and untouched.

### Stage A3 — CRDT at rest: per-scene Y.Doc, merge-on-load *(no network)*

Introduce `yjs` + `y-prosemirror` + `y-indexeddb`. Each scene becomes one small
Yjs document (`XmlFragment` for prose + a `Y.Map` for the label). The Y.Doc's
encoded state is the source of truth; **`scene.body` HTML is demoted to a derived
projection**, re-rendered from the doc on every save so all A2 readers keep working.

**Schema — migration `023` (additive, non-destructive):**

```sql
alter table scenes add column ydoc bytea;             -- Y.encodeStateAsUpdate(doc)
alter table scenes add column ydoc_updated_at timestamptz;
-- body stays as the derived HTML projection.
-- content_edited_at is kept but becomes vestigial; dropped in A5.
```

- **Backfill:** for each existing scene, build a Y.Doc from its current HTML →
  encode → store in `ydoc`.
- **On load:** if server `ydoc` differs from the local `y-indexeddb` state,
  **merge** (Yjs reconciles) rather than pick a winner. This alone fixes A→B→A
  data loss and long-offline merge — with **no network provider yet**.
- `y-indexeddb` subsumes the durable-scene role of [offlineQueue.ts](lib/offlineQueue.ts)
  (notes may stay on the queue).
- **Undo:** browser-native undo → Yjs `UndoManager`, scoped to the local origin so
  a future remote change never lands in the local undo stack.
- **Snapshot vs. update log:** whole-snapshot in `scenes.ydoc` is simplest and fine
  for a solo author (scenes are small). Defer an append-only `scene_updates` table +
  compaction until A4 proves it's needed.
- **Exit:** edit the same scene offline on two devices, reconnect → both edits
  survive **merged**, not one clobbered.

### Stage A4 — Live scene broadcast over Realtime *(the accelerator)*

Broadcast Yjs update binaries over the shared channel (§1.1) on the
`book_chapter:<chapterId>` topic, so A→B propagates within seconds without a manual
refetch. Because the driver is solo cross-device (not co-authoring), this is a
convenience layer over an already-correct merge — awareness/cursors are **out of
scope**. Add snapshot compaction here if the update volume warrants the
`scene_updates` table. **Exit:** typing on A appears on an open B in seconds.

### Stage A5 — Retire the LWW scaffolding

Drop the `content_edited_at` guard from `saveScene`; simplify
[offlineQueue.ts](lib/offlineQueue.ts) now that `y-indexeddb` carries scenes;
retire migration-021 semantics. The Era-2 stopgap is fully replaced.

---

## Track B — Live Conversation

*Goal: Google-Docs-grade — you see who's here, and the conversation mutates under
everyone at once.* Layered over [SHARED_WITH_YOU.md](SHARED_WITH_YOU.md); **none of
this is built yet.**

Today both comment surfaces (`EditorComments` / `ReadComments`) are a static
snapshot of the last page load — one `load()` on mount, no live channel. Presence
has no signal at all; a comment added/edited/deleted by someone else stays stale
until you toggle the tab or reload.

### Refetch-on-signal, not payload-apply

Postgres Changes on `comments` (filtered by `shared_chapter_id`) is treated as
**"something changed → refetch"** via the existing `GET /api/comments`, debounced
~300ms trailing. We deliberately do **not** render the raw realtime row, because
`getComments` ([lib/shared/comments.ts](lib/shared/comments.ts:59)) does enrichment
the bare row lacks — signed avatar URL, author `display_name`, scene id/position
for grouping, and stale detection against the snapshot generation. Local mutations
stay optimistic and instant; remote changes arrive as a debounced refetch. The
rendered list is always authoritative RLS-filtered server state.

### Stage B1 — Partner presence

`<PartnerPresence>` — one shared component in both views, an overlapping `Avatar`
stack ([components/ui/Avatar.tsx](components/ui/Avatar.tsx), propose `size={24}`,
`-space-x-2`, `ring-2` in the surface background).

- Each viewer `track()`s `{ userId, name, avatarUrl, joinedAt }`; the stack shows
  **everyone viewing this chapter except yourself** (symmetric, like Docs).
- **Newest arrival is leftmost and on top** (order by `joinedAt` desc).
- **Cap:** ~5 avatars + a `+M` overflow chip, tracking ceiling ~9 (design knob
  against the frames).
- **Dedup by user:** presence key = `userId` (`config: { presence: { key: userId }}`),
  so one person in two tabs = one avatar.
- **Placement:** chapter-title row, right-aligned to the 700px prose measure. In
  the **write** view ([components/CenterColumn.tsx:193](components/CenterColumn.tsx:193))
  this is a real relayout: the save indicator ("Saved" / "Offline — will sync")
  moves from `top-4 right-4` to sit to the **right of the presence stack** in the
  gutter — pixel-match [360-3742](https://www.figma.com/design/e4DJxj1g7GTcfUpMaMOvVe/Hot-Cocoa?node-id=360-3742).
  Read view: same position, stack alone — [360-3646](https://www.figma.com/design/e4DJxj1g7GTcfUpMaMOvVe/Hot-Cocoa?node-id=360-3646).

### Stage B2 — Live comments

Wire `onCommentsChanged` → debounced `load()` in **both** `EditorComments` and
`ReadComments`. Cards keyed by `comment.id`; `load()` replaces the array so React
reconciles in place.

| Event (by someone else) | What the user sees |
| --- | --- |
| **INSERT** | New card animates into its sorted slot (scene order / stacked position). |
| **UPDATE (body)** | Card text updates in place. |
| **UPDATE (`resolved_at`)** | Card dims/undims inline. |
| **DELETE** | Card removed; if it was the selected/active card, clear `activeId` and tear down the live-text highlight. |

- **Don't clobber an in-progress local edit:** a card the local user is editing
  holds its `draft` in component state keyed by id; same-key reconciliation keeps
  the open editor mounted through a remote refetch. (A partner can't edit *your*
  comment — self-only by RLS — so no single-card write conflict.)
- **Unread integration** ([[shared-with-you]] §6): active & visible → refetch **and**
  re-mark seen (`POST /api/shared/seen`); not active → refetch **and**
  `refreshUnread()` so the tab count and account badge light. Extends today's
  visibilitychange-only refresh to true push.

### Track B edge cases

| Case | Resolution |
| --- | --- |
| Same user, two tabs | Presence keyed by `userId` → one avatar. |
| Access revoked mid-session | Realtime drops the row; presence expires; refetch returns null and the rail empties. Graceful. |
| Chapter switch (writer) | `useSharedLive` releases the old channel, acquires the new; old presence drops. |
| Backgrounded tab | Default **open = viewing** (presence held while mounted). Idle-drop is polish. |
| Offline / disconnect | Presence set empties; on reconnect re-track + refetch. No offline queue (presence is live-only). |
| Dev auth preview ([[dev-auth-preview]]) | No session → private-channel auth fails → **fall back to today's static one-shot `load()`**; local UI verification must not break. |
| Mobile | Stack renders in the mobile header where space allows; tighten cap on narrow widths (design flag). |

---

## 2. Status ledger

| Item | Track | State |
| --- | --- | --- |
| `content_edited_at` LWW save (migration 021) | A1 | ✅ Shipped |
| Remove ConflictModal / SceneConflict / conflicting-copy scenes | A1 | ✅ Shipped |
| Remove single-tab editor lock (`useEditorOwnership` / `EditorLockedOverlay`) | A1 | ✅ Shipped |
| Durable cross-tab offline write queue | A1 | ✅ Shipped |
| Cross-device pull / A→B→A (old CONFLICT_SUNSET Part 2) | A | ⛔️ Never built — **superseded by A3/A4** |
| Realtime channel manager + auth migration (022) | Shared | ◻️ Not started |
| Editor swap to TipTap/ProseMirror (HTML-compatible) | A2 | ◻️ Not started |
| Per-scene Y.Doc, `y-indexeddb`, merge-on-load (migration 023) | A3 | ◻️ Not started |
| Live scene broadcast over Realtime | A4 | ◻️ Not started |
| Retire LWW scaffolding | A5 | ◻️ Not started |
| Partner presence | B1 | ◻️ Not started |
| Live comments | B2 | ◻️ Not started |
| Presence/comments polish & edges | B | ◻️ Not started |

---

## 3. Staged rollout — sequencing across both tracks

Each stage is independently shippable. The shared foundation is built once; the two
tracks then proceed in parallel.

1. **Shared §1.3 — Realtime plumbing.** Migration 022 + `lib/shared/liveChannel.ts`
   + `useSharedLive` + `supabase.realtime.setAuth`. No UI change (or behind a flag).
   *Verify:* two browser sessions on one chapter see each other's presence and
   change events in the console. **Unblocks B1, B2, and A4.**
2. **A2 — Editor swap** (independent of §1.3; the gating UI risk — can start immediately).
3. **A3 — CRDT at rest** (needs A2). Ships the data-loss fix with no network.
4. **B1 — Partner presence** and **B2 — Live comments** (both need §1.3; independent
   of each other and of Track A). The visible, self-contained collaboration wins.
5. **A4 — Live scene broadcast** (needs §1.3 + A3).
6. **A5 — Retire LWW** and **comment anchoring on Y.RelativePosition** (needs A3);
   Track B polish.

> **Recommended first two moves:** A2 (editor swap) and Shared §1.3 (plumbing) —
> they're independent, each de-risks a different half of the epic, and A3/B1/B2 all
> unlock behind them.

---

## 4. Open decisions

Defaults chosen so the epic is buildable; flag if any should change.

**Track A**
1. **Comment anchoring** — migrate comment anchors from body offsets to
   `Y.RelativePosition` once A3 lands (a stated driver). Slot it into A5 or as its
   own stage after A3. **Default: after A3, before A5.**
2. **Snapshot vs. update log** — whole-snapshot `scenes.ydoc` for v1; add
   `scene_updates` + compaction only if A4 volume demands. **Default: snapshot.**
3. **Notes** — keep notes on LWW (they already are); don't CRDT them in v1.
   **Default: LWW.**
4. **Clock-skew hardening** — irrelevant once A3 replaces timestamp comparison with
   CRDT merge; no longer worth building for A1. **Default: drop.**

**Track B**
5. **Symmetric presence** — everyone viewing sees everyone else, author included.
   **Default: symmetric.**
6. **Open = viewing** — presence held while the tab is open even if backgrounded.
   **Default: hold; idle-drop is polish.**
7. **Stack cap / overflow** — 5 shown + `+M`, ceiling 9; avatar `size={24}`. Design
   knobs against the frames.

---

## 5. Verification & conventions

Per [[verify-on-throwaway-content]]: **never type into real scenes/notes** —
editors persist to Supabase. Test sync against throwaway scene ids.

- **A1 (regression):** inject synthetic pending writes with controlled `authoredAt`
  — older than server → no-op + adopt; newer → server updated; reorder-then-edit →
  clean save; two-tab/offline replay → newest survives. Confirm no `ConflictModal`
  can mount (component deleted).
- **A3:** two throwaway devices edit one scene offline → reconnect → both edits
  present and merged.
- **B:** two browser sessions on one shared chapter → presence appears/leaves;
  a comment insert/edit/delete/resolve on one reflects on the other within the
  debounce window; dev-auth preview falls back to static `load()` without error.

---

## 6. Spec reconciliation

When Track B ships, update [SHARED_WITH_YOU.md](SHARED_WITH_YOU.md) and
[SHARED_WITH_YOU_UPDATES.md](SHARED_WITH_YOU_UPDATES.md) in the same PR:
- §3.7 / §3.4 — comments now sync live; drop the "toggle the tab to refresh" behavior.
- §5 — this closes the deferred "notify peer recipients of each other's comments"
  gap **in-app** (email fan-out stays deferred).
- §6 — badges update by realtime push, not only on visibilitychange.
- SHARED_WITH_YOU_UPDATES.md Stage 12 — promote "Live comments & author presence"
  out of the backlog.
