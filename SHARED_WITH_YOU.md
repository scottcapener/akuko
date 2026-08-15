# Shared With You — feature spec

Private, per-chapter sharing and commenting — modeled on Google Drive/Docs. Share a chapter with
specific people by email; they read it and leave anchored comments. All decisions resolved — this is
the spec we build against. Figma screens (§9) are ~complete.

---

## 1. Model

### Core concepts

| Concept | Definition |
| --- | --- |
| **Share** | Author-initiated act that (a) copies one chapter into an immutable **snapshot** and (b) grants one or more recipients access to it. |
| **Shared chapter** | The snapshot. One per live chapter — re-sharing updates it in place. Owned by the author; carries a copy of book identity so recipients can render the chapter without touching the author's live data. |
| **Recipient / grant** | A `(shared chapter, person)` access grant, addressed by email. Existing users get access immediately; unknown emails become **pending** and are redeemed on signup/login. |
| **Shared conversation** | All comments on a shared chapter, visible to the author **and every recipient** — one thread, not per-recipient silos. |
| **Comment** | Anchored to a highlighted range inside one shared scene, and to the live scene by id. Not threaded in v1. |

Access is a flat many-to-many between chapters and people. Two people who both have chapter X shared with
them simply both see X and its conversation.

### Snapshot, not live — the load-bearing decision

Sharing copies the chapter's scene text into `shared_scenes`. Recipients never read the author's live rows.

Why:
- **Comment anchors stay valid forever.** Character offsets into immutable text can't drift. Anchoring into a document the author is actively editing is the hardest part of this feature; snapshotting deletes the problem.
- **Readers see a stable draft** — "the draft you sent," not a document mutating mid-read.
- **RLS stays simple.** Recipients get zero access to `books`/`chapters`/`scenes`. The only cross-user read path is the snapshot tables, which have no relationship to the live editor.
- **It matches how sharing a draft works** — you circulate a fixed copy, then choose when to send an updated one.
- **It's the primitive public sharing will need.** Authors write live and choose when to share a snapshot; the audience sees snapshots the author updates at their discretion. This feature is that mechanism with a private, per-person audience.

Cost: re-sharing is a real operation with real semantics (§7).

### The snapshot keeps the live scene's identity

`shared_scenes.scene_id` points back at the live `scenes` row. Snapshotting copies the *text*, not the
identity. This is what lets comments surface inside the author's live editor (§3.7): the comment→live-scene
join survives every edit. Only the character offsets can go stale, and the editor's comment UI is a list
that doesn't depend on them.

### One snapshot, many recipients

A chapter has **one** snapshot, shared with an arbitrary set of people:

- First share → snapshot created, recipients granted, emails sent.
- Adding a recipient later → a grant row only; they see the **current** snapshot. No re-snapshot.
- **Update shared copy** → re-snapshots in place (§7). Everyone shared sees the update; comments on changed text go stale.
- Because everyone shares the one snapshot and one comment thread, "everyone shared sees all comments" falls out for free.

### Book context in the read view

The `/shared` feed is a flat list of individual chapters. But once a reader **opens** a chapter, they see a
read-only **Book Panel** for that book: cover, title, and every chapter of that book **that has also been
shared with them** — navigable. So sharing three chapters of a book with someone lets them move between
those three in book order while reading. Full book-level sharing (share a whole book at once) is a future
step; v1 shares one chapter at a time and assembles the book view from whatever chapters the reader has
been granted.

---

## 2. Schema (migrations `012`–`015`)

> **As shipped:** the schema landed across four migrations, one per stage, not the single `012` this
> section was first drafted around:
> - `012_chapter_sharing.sql` — `shared_chapters`, `shared_scenes`, `chapter_shares`, `shared_chapter_reads`, the `has_shared_access` predicate + RLS, and the widened profiles read policy.
> - `013_share_redemption.sql` — the email-match redemption RPC (§4).
> - `014_comments.sql` — the `comments` table + RLS + the owner-only resolve function.
> - `015_notification_prefs.sql` — `profiles.notify_on_share boolean not null default true` (§6).

```
shared_chapters                                     -- the snapshot; one per live chapter
  id, chapter_id (FK on delete set null), owner_id,
  book_id,                                          -- groups snapshots into a book in the read view
  book_title, cover_path,                           -- SNAPSHOT of book identity (feed row + Book Panel)
  chapter_title,                                    -- snapshot
  book_position,                                    -- snapshot: order within the book (Book Panel ordering)
  first_shared_at, updated_at, unshared_at          -- updated_at bumps on re-share (generation)
                                                    UNIQUE (chapter_id)

shared_scenes
  id, shared_chapter_id, scene_id, position,
  body_html,                                        -- SANITIZED at share time
  body_text                                         -- plain-text projection; anchors index into this

chapter_shares                                       -- the access grant (per person)
  id, shared_chapter_id,
  recipient_email (citext),                          -- always set; the address the author shared to
  recipient_id (FK profiles, nullable),              -- set when the email maps to an account; null = PENDING
  shared_by,                                         -- == owner in v1, but recorded
  created_at, accepted_at, revoked_at
                                                    UNIQUE (shared_chapter_id, recipient_email)

comments
  id, shared_chapter_id, shared_scene_id, author_id,
  body,                                              -- plain text
  quote_text, quote_start, quote_end,                -- offsets into shared_scenes.body_text
  snapshot_version,                                  -- share generation the quote was made against (§7)
  created_at, updated_at, resolved_at, resolved_by

shared_chapter_reads
  shared_chapter_id, user_id, last_seen_at           PK (shared_chapter_id, user_id)

profiles                                             -- pre-existing; 015 adds one column
  … , notify_on_share (boolean, default true)        -- gates the share email (§6)
```

`shared_chapter_reads` does double duty: **no row = unread shared chapter**; `comment.created_at >
last_seen_at` = unread comment. One table covers both notification sources, from both surfaces (the
`/shared` read view AND the editor Comments tab). Unread-comment state matters for **everyone with access**
— author and recipients alike — because the conversation is shared.

`shared_chapters.updated_at` bumps on every re-share; `comments.snapshot_version` records which generation a
comment's offsets were captured against. A comment whose `snapshot_version` is behind the current generation
AND whose `quote_text` no longer appears is *stale* (§7) — distinct from a comment that can't be located in
the author's live edits, which is normal (§3.7).

### No tokens — redeem by email match

Pending shares (email → no account yet) are redeemed by **email match at signup/login**: when a session's
email equals a `chapter_shares.recipient_email` with a null `recipient_id`, fill in `recipient_id` +
`accepted_at`. No per-share token to mint, carry through email confirmation, or expire. The share email
deep-links to the chapter; the normal auth gate (`?next=`) handles logged-out and no-account cases.

### RLS

One access predicate, reused everywhere:

- `has_access(shared_chapter_id)` — you are the `owner_id`, **or** an accepted recipient
  (`exists (select 1 from chapter_shares where shared_chapter_id = $1 and recipient_id = (select auth.uid()) and revoked_at is null)`).
- `shared_chapters` / `shared_scenes`: read if `has_access`; write only by `owner_id`.
- `chapter_shares`: the owner manages grants (insert/revoke); a recipient may read grants on chapters they can access, and may revoke **their own** grant (§7).
- `comments`: read if `has_access`; insert if `has_access`; update/delete if `author_id = uid`; **resolve** (`resolved_at`) only if you are the chapter owner — a separate policy from the author's own update, so the owner can mark done without editing others' words.

**Widen the profiles read policy.** It is currently `own profile` only ([009_perf_indexes_rls.sql:36](supabase/migrations/009_perf_indexes_rls.sql:36))
— recipient rows and comment attribution would render blank otherwise. Add: *you can read the profile of
anyone you share a chapter with, in either direction* — there exists a `shared_chapters` where {you own it
and they're an accepted recipient} OR {they own it and you're an accepted recipient}. Same migration.

Follow the `(select auth.uid())` InitPlan pattern from migration 009, and index every FK — this is read-heavy.

### Sanitization — reuse the shipped sanitizer

Scene bodies are raw `innerHTML` harvested from a contenteditable ([CenterColumn.tsx:318](components/CenterColumn.tsx:318)).
Today that string only renders back into its own author's browser; sharing makes it render in **someone
else's** browser — a real XSS boundary.

Sanitize server-side, at share time, into `shared_scenes.body_html`. **Use `sanitizeProseHtml` from
[lib/sanitize.ts](lib/sanitize.ts:14)** — it already implements the exact allowlist we need (`em, i,
strong, b, br, div, p`, no attributes; anything else stripped to text), shipped with the account-profile
work. Never sanitize only on render.

### Identity & avatars — already live

`profiles` is `id, display_name, pen_name, avatar_path, bio, created_at` — avatars shipped in `011`.

- **Recipient rows, comment attribution:** `display_name` + avatar.
- **Feed / read-view / Book Panel book credit:** `pen_name || display_name` + avatar.
- **Avatar rendering:** **use [components/ui/Avatar.tsx](components/ui/Avatar.tsx:25)** — `Avatar({ name, src, size })` renders the uploaded image when `avatar_path` resolves and falls back to initials-in-a-circle otherwise (including on a failed/expired signed URL). One component everywhere: comment cards, Share-modal recipient rows, read-view author credit. Do not build a new avatar.
- **Cover images:** `cover_path` is a Supabase Storage path. Recipients have no access to the author's book rows, so covers on the feed and in the Book Panel are served via a **server-generated signed URL** off the snapshot's `cover_path` (reuse the existing signed-URL approach; the expiry fix already shipped). No cover → the Book Panel's placeholder.

---

## 3. Surfaces

### 3.1 Account menu ([LeftColumn.tsx:1038](components/LeftColumn.tsx:1038))

New row above `Account`, label **"Shared with you"**, with a **count badge** (§6). No shares yet → the row
still shows and routes to the empty `/shared`. Sharing starts from a chapter (§3.6), not from this row.

> **As shipped:** the count badge lives on this row in both the workspace nav and the writer's `•••` account
> menu. When the panel is *collapsed* (so the row is hidden), the presence indicator moves to a **dot** on the
> collapsed panel icon / account launcher instead — see §6.

### 3.2 `/shared` — the Shared With You feed

A **flat, chronological list** of individual chapters shared *with me*, in the order they were shared
(newest first). Each row: book cover (signed URL), chapter title, book title, author (`pen_name ||
display_name`) + avatar, relative time, unread dot. Click a row → the read view (§3.3).

- **No left column, no right column** on the feed itself. Return to the editor via the same `← Back to Hot Cocoa` nav used elsewhere.
- Shows only chapters shared **with** you. Chapters **you** share are managed from the editor (§3.6), not listed here.
- Empty state per §9.

### 3.3 Read view — `/shared/[sharedChapterId]`

One shared chapter, with book context.

- **Center:** prose. `font-serif text-manuscript-l indent-9`, `max-w-[700px]` — identical typography to the editor so the draft reads the way it was written. Scenes render as continuous prose separated by a scene-break mark. Scene **labels are hidden** (author workspace metadata, not the draft).
- **Left column — read-only Book Panel:** book cover (signed URL), book title, author (`pen_name || display_name`) + avatar, and the list of that book's chapters **that have also been shared with the reader**, in `book_position` order. Clicking a chapter loads its read view. Not editable. The reader may toggle list/grid view; this toggle needs its **own** localStorage key (the editor's `hc.sectionViews` is keyed by section id — these are a flat, sectionless list in book order).
- **Left/right arrow keys** move between the reader's accessible chapters of this book in book order — a different ordering from the feed's share order, deliberately. *(Stage 10.2 replaced the on-screen prev/next arrows with keyboard-only ←/→; sibling chapters are prefetched so the move is instant.)*
- **Right column:** comments (§3.4).
- **Not shown:** the chapter Library (images, notes, music, links) — the author's workspace, not the draft.
- `← Back` returns to `/shared`.

### 3.4 Comments column (read view)

Highlight text → on `mouseup`, a blank comment card appears in the right column, focused, at the top of the
highlighted range.

**Positioning.** Each card wants `top = anchorRect.top − containerTop`. Sort by (scene position,
`quote_start`), then cascade: `top = max(desiredTop, prevBottom + gap)`. Downward-only in v1.

**Permission states** — four visual states. The conversation is shared, so **recipients see each other's
comments** (read-only), not just their own:

| Situation | Affordances |
| --- | --- |
| Your comment | tap to edit, `×` to delete |
| You own the chapter, someone else's comment | check to mark done (resolve) |
| Not your chapter, another recipient's comment | read-only |
| Resolved | dimmed, shown inline (no toggle) — the author deletes what no longer applies. *(Stage 7 removed the "Show N resolved" collapse; see SHARED_WITH_YOU_UPDATES.md 7.1.)* |

The chapter owner can resolve but **cannot delete or edit** others' comments. That boundary is what keeps
sharing trustworthy. **No replies in v1** — design the card so a reply affordance can be added later without a redesign.

### 3.5 Share modal — recipients only

Opened from the sharing mini-menu (§3.6). Purely recipient management:

- **Recipient input** — type an email to add someone; Enter/comma commits a chip.
- **Current recipients** — who this chapter is shared with now: `Avatar` + name (or the raw email if still pending, with a "pending" hint), and an `×` to **revoke** that person's access.
- States plainly that recipients see a snapshot.
- **Confirm:**
  - *First share* → snapshot the chapter (via `sanitizeProseHtml`), create `chapter_shares` rows, send emails.
  - *Add recipient to an already-shared chapter* → grant row + email only; no re-snapshot (they see the current copy).

There is deliberately no reshare from the recipient side — recipients read and comment; they don't forward.

> **Deferred to a fast-follow, not v1:** the "recent share partners" quick-list (tappable chips of people you
> shared with recently). v1's modal is just the email input + current-recipients list. Leave a natural spot
> for the quick-list above the input so adding it later is not a redesign.

### 3.6 Sharing mini-menu — the entry point (editor right column)

The author shares from **where they write**. A **`•••` mini-menu button sits at the bottom-right of the
Write page's right column.** It is the single management surface for a chapter's sharing, and it holds the
snapshot actions (they are **not** in the Share modal):

- **Not yet shared:** one item — **"Share this chapter…"** → opens the Share modal (§3.5); the first confirm creates the snapshot.
- **Already shared:**
  - **"Manage sharing…"** → the Share modal (add/remove recipients).
  - **"Update shared copy"** → re-snapshots the chapter in place (§7); a confirm step warns that comments on changed passages will move to a previous version. *Spec intent: offer only when the live text has diverged from the snapshot — **not yet implemented**, the action is always offered (harmless, since comments now survive the re-share). Divergence-gating is a Stage 4 polish item.*
  - **"Stop sharing"** → revokes all grants and deletes the snapshot + its comments (§7).

The button also reflects state at a glance (unshared vs. "Shared with N").

### 3.7 Comments in the live editor — Comments tab

Comments must reach the author where they work: the live Chapter Editor.

**Entry point.** A Comments tab icon at the top of the right column, **next to the Library icon**. Clicking
it swaps the Library's content for Comments content — same column, toggled content, not a new panel. The tab
carries its **own dot**: unread comments on the *currently open* chapter. (The sharing mini-menu, §3.6, lives
at the bottom-right of this same column, independent of which tab is active.)

**Two tiers off the one `scene_id` link:**

*Tier 1 — grouping (always works).* List this chapter's comments grouped by scene, in scene order, joining
`comments → shared_scenes.scene_id → live scene`. Each card shows the quoted snapshot text, the comment, and
the author. Click → the editor scrolls to that scene (reuses the Book-Panel scene-scroll mechanism). No
offset math, never breaks.

*Tier 2 — highlighting (opportunistic).* Search the *live* scene's plain text for `quote_text`. Exactly one
match → highlight it. Zero or multiple → no highlight; the card still shows the quote. Recomputed on render,
never stored, degrades silently.

**Two "unlocatable" meanings, rendered differently:**
- *Can't find the quote in live text* → normal (you revised). No warning styling.
- *Stale against a re-shared snapshot* (§7) → its own subdued treatment.

**Behavior:**
- Opening the tab upserts `last_seen_at = now()` for the open chapter — same `shared_chapter_reads` write as the read view, clearing the notification from both surfaces.
- **Resolve works from the editor.** Read → revise → check off is the whole loop. Permissions identical to §3.4.
- After a re-share, comments whose quote no longer appears show inline (dimmed), no longer collapsed under a
  "Show N from previous version" toggle. *(Stage 7 / 7.1 removed the toggle; in the read view they list at the
  top of the comments rail since they can't anchor to the changed prose.)*

---

## 4. Getting access

There is no group to join. A recipient reaches a shared chapter through the share email or the `/shared` feed:

1. Author shares to an email → `chapter_shares` row.
   - Email maps to an existing account → `recipient_id` set immediately; access is live.
   - Email has no account → row is **pending** (`recipient_id` null).
2. Share email deep-links to `/shared` (or directly to `/shared/[sharedChapterId]`).
3. **Logged in** → lands on the target.
4. **Logged out** → `/login?next=…` → target.
5. **No account** → `/signup?next=…`; on completing signup, all pending shares matching the new account's email are redeemed (`recipient_id` + `accepted_at`) and the target resolves.

No tokens, no expiry, no single-use juggling.

---

## 5. Email

Resend is already configured for this project **as Supabase custom SMTP** ([DEPLOYMENT.md:14](DEPLOYMENT.md:14)),
which only carries Supabase Auth's own templates. It cannot send app-authored mail. So this feature adds:

- the **`resend` npm package** (app-level API client) — *approved, add it*,
- a **`RESEND_API_KEY`** in `.env.local` + Vercel — Scott mints the key,
- a `lib/email/` module with the template.

**Transactional email: "{Author} shared a chapter with you."** Sent to each newly added recipient, naming the
book + chapter and deep-linking to `/shared/[sharedChapterId]`. Works for existing and pending (no-account)
recipients — the auth gate handles the rest. Needs a footer unsubscribe link and a per-user notification
preference.

> **As shipped:** the preference is `profiles.notify_on_share` (default on), toggled from **Settings →
> Notifications**. The share flow skips emailing accounts that opted out (pending/no-account recipients always
> get it — it's how they discover the share), read through the service-role client so a recipient's preference
> is never exposed to the author. The email footer links to `/unsubscribe`, which — since there are no tokens
> (§4) — identifies the person by their signed-in session and flips their own `notify_on_share` off.

Open item for Scott: confirm the From address for share mail (`noreply@hotcocoa.app` matches signup; a
repliable address may read better for a personal "someone shared with you" note).

Comment activity stays in-app (dots/badges, §6) in v1 — no per-comment email.

---

## 6. Notifications

One unread source (`getUnreadState` → `GET /api/shared/unread`) feeds every badge. A chapter is **unread for
you** when:
- it was shared with you and has no `shared_chapter_reads` row yet (a new share you've never opened), **or**
- you have access to it (as owner **or** recipient) and it has comments by someone else newer than your `last_seen_at`.

**Counts** (numbers):
- **Account-menu "Shared with you" row** (workspace nav + writer's `•••` menu) = the number of **unread
  chapters**. A chapter with three new comments counts once — the badge answers "how many chapters need my
  attention," not "how many comments." (`> 9` renders as `9+`.)
- **Editor Comments tab icon** = the number of unread comments **on the open chapter**.

**Dots** (presence only, where a count doesn't fit): the account launcher (`•••`) and the collapsed
Book-panel icon (any unread chapters); the collapsed Library-panel icon (the open chapter has unread
comments).

> **As shipped — reconciled from the first draft:** this section originally called for a dot on the
> account-menu row and on the Comments tab. The Stage 3 Figma put a **count** on both (matching §3.1's "count
> badge"), so counts are used there; **dots** are reserved for the launcher + collapsed-panel icons above.
> "Distinct unread items" is implemented as **unread chapters** (per the count decision).

Opening a chapter in the read view **or** opening the editor Comments tab upserts `last_seen_at = now()` and
refreshes every badge at once.

> **Known gap:** the `/shared` feed's per-row unread dot (§3.2) currently reflects only *never-opened*
> (`feed.ts`), not the newer-comments half of the definition above — so a chapter you've opened that then gets
> a new comment lights the account badge but not its feed row. Alignment is a Stage 4 polish item.

---

## 7. Edge cases — all resolved

| Case | Resolution |
| --- | --- |
| **Update shared copy** | Re-snapshots in place; bumps `shared_chapters.updated_at` (generation). **As shipped:** `snapshotChapter` reconciles `shared_scenes` by `scene_id` (update / insert / delete) so comments keep their `shared_scene_id` anchor and survive the re-share. A comment whose `quote_text` no longer appears then renders **stale** — attributed, unhighlighted, shown inline (no toggle) in the editor Comments tab and listed at the top of the read-view rail (its offsets can't anchor to the changed prose). No versioning in v1. *(Stage 7 / 7.1 dropped the "Show N from a previous version" collapse.)* |
| **Adding a recipient after commenting has started** | New grant only. They immediately see the current snapshot **and the existing conversation** — one thread, not a fresh silo. |
| **Author revokes one recipient** | Sets `chapter_shares.revoked_at`. That person loses access; their existing comments **persist**, still attributed, still visible to everyone else with access. |
| **Author stops sharing entirely** | Revokes all grants and deletes the snapshot + its comments. Distinct from revoking one person. |
| **Recipient removes it from their list** | A recipient may revoke **their own** grant ("Remove from Shared with you"). Removes it from their feed; does not affect others. |
| **Author deletes the live chapter** | Snapshot survives (`chapter_id` FK `on delete set null`). The delete modal gains an **"also stop sharing this chapter" checkbox, defaulted UNCHECKED**, shown **only when the chapter is currently shared**. Unchecked keeps what recipients already read + commented on. |
| **Recipient signs up after being shared to** | Pending grant redeemed by email match at signup/login (§4). |
| **Mobile read view** | Comment column becomes inline markers that open a bottom sheet; the Book Panel collapses to a header/drawer. |

---

## 8. Stages

Each stage is independently shippable and reviewable.

### Stage 1 — Share & read (the MVP) — ✅ Shipped
Migrations `012_chapter_sharing.sql` + `013_share_redemption.sql` (`shared_chapters`, `shared_scenes`, `chapter_shares`,
`shared_chapter_reads`, the widened profiles read policy, RLS). Snapshot/share action reusing
`sanitizeProseHtml`. `resend` package + `lib/email/` + the "shared a chapter with you" email. The
**bottom-right sharing mini-menu** + **Share modal** (email input, current recipients with revoke,
first-share / add-recipient). Email-match redemption (§4). `/shared` flat feed. `/shared/[sharedChapterId]`
read view with the read-only **Book Panel** (cover, title, author, accessible-chapter list + list/grid
toggle, arrow navigation). Account-menu "Shared with you" row (no badge yet). Signed-URL covers. Reuse
`Avatar` throughout.

*Ships:* share a chapter with a specific person by email and have them read it, with book context — the core of the feature, useful even before comments.

### Stage 2 — Comments (both surfaces) — ✅ Shipped
Shipped as 3 PRs: (1) migration `014_comments.sql` + data layer + CRUD API; (2) read-view comments; (3) the
editor Comments tab.
Migration `014_comments.sql` + RLS. **Read view:** highlight-to-comment, offset anchoring, right-column
positioning + stacking, all four permission states (incl. other-recipient read-only), edit/delete/resolve.
**Editor:** Comments tab next to the Library icon, tier-1 grouping + tier-2 opportunistic highlight, resolve
from the editor.

*Ships:* the feedback loop, reaching the author where they write.

### Stage 3 — Notifications — ✅ Shipped
Shipped as 3 PRs: (1) unread data layer (`getUnreadState` + `/api/shared/unread` + read cursors); (2) the
badge component + placements across the nav, account menu, and editor; (3) notification settings +
share-email unsubscribe (migration `015_notification_prefs.sql`).
`shared_chapter_reads` wiring. Account-menu row **count**, launcher + collapsed-panel **dots**, Comments-tab
**count** (see §6 for why counts vs. dots) — unread state working for owner and recipients alike. Notification
preference + unsubscribe on the share email.

### Stage 4 — Edges & polish — ◐ Partial (A, B shipped)
Original scope: update-shared-copy / stale comments; delete-chapter "also stop sharing" checkbox; revoke one /
stop sharing all / remove-from-my-list; "Show N from previous version" grouping; mobile read view + comment
sheet + collapsed Book Panel; resolved-comment display; empty states throughout. **Fast-follow:**
recent-share-partners quick-list in the Share modal (§3.5).

**Shipped (2 PRs):**
- **A — Re-share preserves comments + stale rendering.** `snapshotChapter` reconciles `shared_scenes` by
  `scene_id` (fixing a latent bug where re-share cascade-deleted every comment); stale detection in
  `getComments`; "Show N from a previous version" grouping in both the editor and read view; "Update shared
  copy" confirm + live refresh. (Covers the "Show N from previous version" item too.)
- **B — Delete-chapter "also stop sharing" checkbox.** Default unchecked, shown only when the chapter is
  shared; stops sharing before deleting so the snapshot (keyed by `chapter_id`) is removed in the right order.

**Outstanding:**
- **C — Remove-from-my-list** (recipient self-revoke of their own grant). **Shipped** in the Stage 9 fast-follow
  (SHARED_WITH_YOU_UPDATES.md): the feed item's ••• → "Remove from Shared with you" → `DELETE /api/shared/[id]`.
- **D — Mobile read view.** The Book Panel, comments rail, and comments toggle are all desktop-only
  (`hidden md:*`), so mobile currently shows prose only. Needs the inline comment markers + bottom sheet +
  collapsed Book-Panel drawer (§3.3/§7). Needs Figma.
- Revoke-one / stop-sharing-all already shipped in Stages 1–2 (Share modal `×` + mini-menu "Stop sharing").
- Resolved-comment display shipped in Stage 2 ("Show N resolved" toggle, both surfaces).
- **Divergence-gating** on "Update shared copy" (§3.6) — not implemented.
- **Feed row dot vs. comment-unread** alignment (§6 known gap).
- Empty-states pass — feed / read-view / comments empties exist; no dedicated audit was done.
- **Fast-follow:** recent-share-partners quick-list (§3.5).
- **Open item for Scott:** confirm the share-email From address (§5).

> **Fast-follow / polish:** the post-Stage-4 punch-list (comment-card polish, Chapter Menu redesign, Read-view
> design match, Shared-page item + author filter, deferred emails/recent-partners, and the needs-decision
> backlog) is organized into stages 5–12 in [SHARED_WITH_YOU_UPDATES.md](SHARED_WITH_YOU_UPDATES.md).

---

## 9. Figma screens needed

Roughly stage-ordered, so design stays one stage ahead of build.

**Stage 1** — account menu with the "Shared with you" row · `/shared` empty state · `/shared` populated flat
feed (row = cover, chapter title, book title, author + avatar, time, unread dot) · read view (prose center,
read-only Book Panel with cover/title/author/accessible-chapter list + list/grid toggle + arrows) · read-view
empty/placeholder · **the bottom-right `•••` sharing mini-menu** (unshared: "Share this chapter…"; shared:
"Manage sharing…", "Update shared copy", "Stop sharing") · **Share modal** (email input, current recipients
with pending state + revoke `×`) · "shared a chapter with you" email

**Stage 2** — read-view comment composer in focus · comment card in all four permission states (incl. another
recipient's, read-only) · resolved/collapsed state · stale-comment state · stacking with many comments ·
**editor right column with Library / Comments tabs + the bottom-right sharing mini-menu** · Comments-tab list
grouped by scene · in-editor highlight state · "unlocatable vs. stale" treatments

**Stage 3** — badge treatments (row count · row dot · Comments-tab dot) · notification preferences

**Stage 4** — delete-chapter modal with "also stop sharing" checkbox · update-shared-copy confirm · revoke /
stop-sharing / remove-from-my-list confirms · mobile `/shared` feed · mobile read view + collapsed Book Panel ·
mobile comment sheet · (fast-follow) Share modal with recent-share-partners quick-list

---

## 10. Build note

`AGENTS.md`: this is Next.js 16.2.6 with breaking changes from training data. Read the relevant guide in
`node_modules/next/dist/docs/` before writing route handlers, dynamic route params, or metadata for any new
page (`/shared`, `/shared/[sharedChapterId]`) in this feature.
