> 🪦 **ARCHIVED — superseded by [REALTIME_SYNC.md](../REALTIME_SYNC.md).** This
> spec has been coalesced into the unified Realtime Sync epic (Track B · Live
> Conversation, plus the shared Realtime foundation §1). **None of it was built.**
> Note: the "migration 018" numbering below is stale — 018 is already
> `comment_owner_delete`; the realtime auth migration is renumbered to 022 in the
> unified doc. Kept for the presence/comments design detail; do not build from this
> doc — build from REALTIME_SYNC.md. Relative links below are as-written from the
> repo root (pre-archive).

---

# Live Collaboration — feature spec

Realtime layer over [Shared With You](SHARED_WITH_YOU.md): **partner presence** (who's viewing a chapter
right now) and **live comments** (comments appear / update / vanish for everyone the moment they change, no
refresh). This is the build-out of the Stage 12 backlog item "Live comments & author presence" in
[SHARED_WITH_YOU_UPDATES.md](SHARED_WITH_YOU_UPDATES.md). [SHARED_WITH_YOU.md](SHARED_WITH_YOU.md) stays the
canonical sharing spec; this doc owns the realtime additions and updates that spec's §-decisions where they
change (§9 here).

> **Related:** [CONFLICT_SUNSET.md](CONFLICT_SUNSET.md) reuses this doc's realtime
> plumbing (refetch-on-signal model §2, ref-counted channel manager §3, auth +
> migration §6/§8) for solo-author cross-device *scene* sync. It watches `scenes`
> (not `comments`) and keys on `book_id`/`chapter_id` (not `shared_chapter_id`,
> which only exists for shared chapters). Its Part 2 can ship without Realtime
> (focus-refresh) or on top of Stage 13.1 here.

Figma: **Hot Cocoa** (`e4DJxj1g7GTcfUpMaMOvVe`) — presence in
[read view 360-3646](https://www.figma.com/design/e4DJxj1g7GTcfUpMaMOvVe/Hot-Cocoa?node-id=360-3646) and
[write view 360-3742](https://www.figma.com/design/e4DJxj1g7GTcfUpMaMOvVe/Hot-Cocoa?node-id=360-3742).

---

## 1. What users feel

The conversation is shared, but today it's a static snapshot of the last page load (see the current
`EditorComments`/`ReadComments`: one `load()` on mount / tab-open, no live channel). The gaps users feel:

- **Presence** — "is anyone actually reading this right now?" No signal at all today.
- **A comment appears** while you're looking — today it stays invisible until you toggle the Comments tab or reload.
- **A comment is deleted / edited / resolved** by someone else — today the stale copy lingers on your screen.

The target is Google-Docs-grade: you see who's here, and the conversation mutates under everyone at once.

---

## 2. The load-bearing decision — Supabase Realtime, refetch-on-signal

We are already fully on Supabase; the browser client (`lib/supabase/client.ts`,
`@supabase/supabase-js` 2.106) ships Presence, Postgres Changes, and private-channel Realtime Authorization.
**No new transport, no polling loop, no third-party service.**

Two realtime mechanisms, one channel per chapter:

| Need | Mechanism |
| --- | --- |
| **Presence** (who's viewing) | Realtime **Presence** — each viewer `track()`s themselves; `sync`/`join`/`leave` give the live set. Ephemeral, in-memory in Realtime; no DB table. |
| **Live comments** (appear / edit / delete / resolve) | Realtime **Postgres Changes** on the `comments` table, filtered by `shared_chapter_id`. |

### Postgres Changes is a *signal*, not the payload

The change event is treated as **"something changed on this chapter" → refetch** via the existing
`GET /api/comments`, debounced. We deliberately do **not** render the raw row from the realtime payload.

Why refetch instead of applying the payload:
- `getComments` ([lib/shared/comments.ts](lib/shared/comments.ts:59)) does real enrichment the raw row lacks —
  signed avatar URL, author `display_name`, scene id/position for grouping, and **stale** detection against the
  current snapshot generation (§7 of the sharing spec). Re-deriving all that client-side from a bare
  `comments` row would duplicate that logic and drift from it.
- Both comment surfaces already have exactly this `load()` + `setComments` shape and already do optimistic
  local mutations for the current user's own edits. Realtime only needs to cover **other people's** changes,
  and "invalidate → reuse `load()`" is a one-line hook into code that already works.
- Comment volume is a writing group, not a chat room. A debounced full refetch on change is cheap and
  correct; per-row reconciliation would be more code for no felt benefit.

So: **local mutations stay optimistic and instant** (unchanged); **remote changes arrive as a debounced
refetch.** The rendered list is always the authoritative RLS-filtered server state.

### Plan fit

Realtime is available on the Supabase **free** tier (concurrent-connection + monthly-message limits that a
private writing-group app sits comfortably under). This does **not** hit the "no Supabase Pro" wall that
deferred gallery thumbnails ([[library-image-thumbnails]]). Presence heartbeats are the main message volume;
§7's hidden-tab handling keeps them low.

---

## 3. One channel per chapter, ref-counted

Everything keys off the **`shared_chapter_id`** (the snapshot id) — the one identity both surfaces already
resolve to:
- **Read view** has it in the route (`/shared/[sharedChapterId]`).
- **Write view** resolves `chapterId → sharedChapterId` via `GET /api/share` (both `SharingMenu` and
  `EditorComments` already do this fetch).

Channel topic: **`shared_chapter:<sharedChapterId>`**, opened as a **private** channel (§6).

Two consumers want the same channel at once — the **presence stack** (in the chapter-title row) and the
**comment list** (Comments tab / read rail). Opening two channels per chapter would double presence entries
and connections. So realtime lives behind a **module-scoped, ref-counted manager**, mirroring the
`useUnread.ts` module-store-plus-subscribers pattern already in the codebase:

```
lib/shared/liveChannel.ts   (new)
  getChannel(sharedChapterId, { userId, name, avatarUrl }) → handle
    - first caller opens the Supabase channel, tracks presence, subscribes to
      postgres_changes on comments (filter: shared_chapter_id=eq.<id>)
    - returns { onPresence(cb), onCommentsChanged(cb), release() }
    - last release() untracks + removes the channel
  presence deduped by userId (see §4); comment changes fan out to subscribers,
  each debounced ~300ms trailing.
```

A thin `useSharedLive(sharedChapterId)` hook wraps acquire/release around component lifetime and exposes
`{ viewers, subscribeCommentsChanged }`. Auth: private channels need the user JWT — call
`supabase.realtime.setAuth(accessToken)` from the current browser session before subscribe.

---

## 4. Partner presence

### Behavior (from the user's brief + the frames)

- Each viewer `track()`s `{ userId, name, avatarUrl, joinedAt }` on subscribe.
- The stack shows **everyone currently viewing this chapter except yourself** — symmetric, like Docs: the
  author sees partners, partners see the author and each other. (The read frame shows the stack on a
  *reader's* screen, confirming it's not author-only.)
- **1 viewer → 1 avatar.** They leave → it disappears. A second viewer's avatar appears **to the left** of
  the first, slightly overlapping; a third to the left of the second; and so on — **newest arrival is
  leftmost and on top** (order by `joinedAt` desc; leftmost has the highest z-index).
- **Cap:** render up to **N** avatars (propose **5**), then a `+M` overflow chip; stop *tracking-render*
  past a ceiling of **9** distinct viewers (the user's "maybe 9"). Exact cap/overflow is a design knob —
  flag against the frame.
- **Dedup by user:** one person in two tabs = one avatar. Set the Realtime presence **key to the userId**
  (`config: { presence: { key: userId } }`) so multiple metas collapse to one entry.
- **Leaves** fire on unmount, navigation, tab close, and connection loss (Realtime auto-untracks a dropped
  client). Chapter switch in the writer releases the old channel and acquires the new, so presence follows
  the open chapter.

### Component — `<PartnerPresence>`

One shared component, reused in both views. Renders the overlapping `Avatar` stack:
- Reuse [components/ui/Avatar.tsx](components/ui/Avatar.tsx) (uploaded image → initials fallback), **slightly
  larger** than the Chapter Menu's `size={20}` stack ([SharingMenu.tsx:177](components/sharing/SharingMenu.tsx:177))
  — propose `size={24}`, overlap `-space-x-2`, `ring-2` in the surface's background color.
- Hover/tap a viewer → name tooltip. Empty set → renders nothing (no placeholder).

### Placement

Both frames put the stack **on the chapter-title row, right-aligned to the right edge of the prose column**
(the `max-w-[700px]` measure).

- **Write** ([CenterColumn.tsx:193](components/CenterColumn.tsx:193)): the chapter header is `h-16` with a
  centered `max-w-[700px]` title box, and the **save indicator is currently absolutely positioned at
  `top-4 right-4`** (screen edge). Rework: the presence stack sits at the **right edge of the 700px measure**;
  the **status indicator ("Saved" / "Offline — will sync") moves to sit to the *right* of the presence
  stack**, in the gutter. This is a real relayout of that header + the save indicator — pixel-match to
  [360-3742](https://www.figma.com/design/e4DJxj1g7GTcfUpMaMOvVe/Hot-Cocoa?node-id=360-3742).
- **Read** (read-view header row): same right-aligned position at the prose edge. No save status in the read
  view, so the stack sits alone. Match [360-3646](https://www.figma.com/design/e4DJxj1g7GTcfUpMaMOvVe/Hot-Cocoa?node-id=360-3646).

---

## 5. Live comments

Wire the channel's `onCommentsChanged` into **both** `EditorComments` and `ReadComments`: on a debounced
signal, call the component's existing `load()`. Because cards are keyed by `comment.id` and `load()` replaces
the array, React reconciles in place. Per event type:

| Event (by someone else) | What the user sees |
| --- | --- |
| **INSERT** | New card animates into its sorted slot — scene order (editor) or stacked position (read rail). |
| **UPDATE (body)** | The card's text updates in place. |
| **UPDATE (`resolved_at`)** | Card dims (resolve) / un-dims (re-open) inline, per §3.4 of the sharing spec. |
| **DELETE** | Card is removed. If it was the **selected/active** card, clear `activeId` and tear down the live-text highlight (mirror the existing local-delete / local-resolve teardown). |

### Details that matter

- **Debounce** (~300ms trailing) coalesces bursts (e.g. someone deleting several comments) into one refetch.
- **Don't clobber an in-progress local edit.** A card the local user is editing holds its `draft` in
  component state keyed by id; `load()` replacing the array keeps that React element mounted (same key), so
  the open editor survives a remote refetch. A remote edit to a *different* card just re-renders. (Edge: a
  partner cannot edit *your* comment — edit is self-only by RLS — so there's no true write conflict on a
  single card.)
- **Unread integration.** A remote INSERT by someone else must keep the badges honest ([[shared-with-you]] §6):
  - Comments tab / read rail **active & visible** → refetch **and** re-mark seen (`POST /api/shared/seen`),
    so a comment you're literally looking at doesn't badge itself.
  - **Not active** → refetch (or just invalidate) **and** `refreshUnread()` so the Comments-tab count and
    account badge light. This extends today's visibilitychange-only refresh to true push.
- **Read-rail relayout.** `ReadComments` re-runs its stacking `relayout` off the `comments` effect already,
  so a live insert/remove reflows the cascade for free.

---

## 6. Access control

Two independent gates, both anchored on the existing `has_access(shared_chapter_id)` predicate
([SHARED_WITH_YOU.md §2 RLS](SHARED_WITH_YOU.md)):

- **Comment changes** — `comments` already has RLS. Realtime Postgres Changes honors the table's **SELECT
  policy per row per subscriber**, so change events are delivered only to users who could read that row. A
  non-recipient subscribing to the topic receives nothing. (Requires the table in the realtime publication
  and `REPLICA IDENTITY FULL` so UPDATE/DELETE carry the old row for the RLS check — see §8.)
- **Presence / broadcast** — gated by making the channel **private** and adding a **Realtime Authorization**
  policy on `realtime.messages`: authorize read/write when the topic's `shared_chapter_id` (parsed from
  `realtime.topic()`, format `shared_chapter:<uuid>`) passes `has_access`. Only people who can access the
  chapter can join the channel or see who else is present.

Defense in depth: even the comment refetch is independently RLS-gated (`GET /api/comments` returns null
without access), so no comment data can leak through the refetch path regardless of channel state.

---

## 7. Edge cases

| Case | Resolution |
| --- | --- |
| **Same user, two tabs** | Presence keyed by `userId` → one avatar. |
| **You in your own stack** | Never — the stack filters out `currentUserId`. |
| **Access revoked mid-session** | Realtime drops the row from that user's feed; their presence entry expires; a refetch returns null and the rail/tab empties. Graceful, no special-casing. |
| **Chapter switch (writer)** | `useSharedLive` releases the old channel and acquires the new; old-chapter presence drops immediately. |
| **"Update shared copy" (re-share)** | Unrelated to realtime — comments keep their `shared_chapter_id`. The existing `hc:shared-updated` → `load()` path still fires; a realtime refetch would reach the same state. |
| **Backgrounded tab** | Default: **open = viewing** (presence held while mounted, even if the tab is hidden), to avoid presence flapping on every tab switch. Dropping presence on prolonged `visibilitychange:hidden` (idle) is a §10 polish knob, not v1. |
| **Offline / disconnect** | Realtime disconnects → presence set empties; on reconnect, re-track + refetch. No offline queue (presence is live-only; comment writes already ride the app's normal POST path). |
| **Dev auth preview** ([[dev-auth-preview]]) | No session → private-channel auth fails → presence + live sync **disable and fall back to today's static one-shot `load()`**. Local UI verification must not break. |
| **Mobile** | Stack renders in the mobile header where space allows; tighten the cap / hide beyond a small N on narrow widths. Detail deferred, flag for design. |

---

## 8. Schema & policies — migration `018`

No new app tables (presence is ephemeral). One migration:

1. **Publish comments to Realtime:** add `comments` to the `supabase_realtime` publication.
2. **`ALTER TABLE comments REPLICA IDENTITY FULL;`** — so UPDATE/DELETE events carry the old row (needed for
   the per-row RLS check and to know *which* comment was deleted).
3. **Realtime Authorization** for the private channel: RLS policies on `realtime.messages` (SELECT for
   receiving presence/broadcast, INSERT for tracking/broadcasting) that authorize when the topic's parsed
   `shared_chapter_id` passes `has_access`. Reuse the existing predicate; follow the `(select auth.uid())`
   InitPlan pattern from migration 009.

Per [AGENTS.md](AGENTS.md): this is Next.js 16.2.6 — no new route handlers are strictly required here (the
channel is opened client-side and `GET /api/comments` already exists), but read the relevant guide before any
new endpoint.

---

## 9. Spec reconciliation

When built, update [SHARED_WITH_YOU.md](SHARED_WITH_YOU.md) and
[SHARED_WITH_YOU_UPDATES.md](SHARED_WITH_YOU_UPDATES.md) in the same PR:
- §3.7 / §3.4 — comments now sync live; the "must toggle the tab to refresh" behavior this doc replaces.
- §5 — this closes the deferred "notify peer recipients of each other's comments" gap **in-app** (the email
  fan-out stays deferred; presence + live rail is the in-app answer).
- §6 — badges now update by realtime push, not only on visibilitychange.
- SHARED_WITH_YOU_UPDATES.md Stage 12 — promote "Live comments & author presence" out of the backlog into
  the stage below.

---

## 10. Stages

Each independently shippable. 13.2 and 13.3 both depend on 13.1 but are independent of each other.

### Stage 13.1 — Realtime plumbing
Migration `018` (publication + `REPLICA IDENTITY FULL` + `realtime.messages` authorization). The
`lib/shared/liveChannel.ts` ref-counted manager + `useSharedLive` hook + `supabase.realtime.setAuth`. No UI
change (or behind a flag). *Verify:* two browser sessions on one chapter see each other's presence and
comment-change events in the console.

### Stage 13.2 — Partner presence
`<PartnerPresence>` stack. Wire into the write `CenterColumn` header (**relayout** the save indicator to sit
right of the stack) and the read-view header. Dedup, ordering (newest-left), cap + overflow. The visible,
self-contained win. *Depends on 13.1.*

### Stage 13.3 — Live comments
Hook `onCommentsChanged` → debounced `load()` in `EditorComments` + `ReadComments`. Appear / edit / delete /
resolve; selection + highlight teardown on remote delete/resolve; unread integration (seen-vs-refresh gated
on tab visibility). *Depends on 13.1.*

### Stage 13.4 — Polish & edges
Overflow chip tuning, hidden-tab/idle presence, mobile header treatment, reconnect/revoke-mid-session
hardening, dev-preview fallback. Pixel pass against both frames.

---

## 11. Open decisions

Defaults are chosen so the spec is buildable; flag if any should change:

1. **Symmetric presence** — everyone viewing sees everyone else, author included. (Alternative: author-only
   sees partners. The read frame implies symmetric.) **Default: symmetric.**
2. **Open = viewing** — presence held while the tab is open even if backgrounded, rather than dropping on
   hidden. **Default: hold; idle-drop is 13.4 polish.**
3. **Stack cap / overflow** — 5 shown + `+M`, ceiling 9. **Design knob against the frames.**
4. **Avatar size** — `24` (vs the Chapter Menu's `20`). Confirm against the frame.
