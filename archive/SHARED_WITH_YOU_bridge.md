> 🌉 **BRIDGE / TRANSITION COPY — not the live spec.**
> This is the first "Shared With You" draft, kept because it explicitly documents the shift
> **from the group-chat model → per-chapter sharing** (the "Supersedes / unchanged / old model"
> framing throughout). Useful for anyone who knew the writing-groups plan and wants to understand
> what changed and why. The clean, build-against-it spec — which drops all backward references and
> carries later design decisions (sharing mini-menu, book panel in Read, live avatars) — is
> [`SHARED_WITH_YOU.md`](../SHARED_WITH_YOU.md) at the repo root. Build against that, not this.

---

# Shared With You — feature spec

Private, per-chapter sharing and commenting — modeled on Google Drive/Docs, not a group chat.
All decisions resolved. Scott is designing screens in Figma from §9.

> **Supersedes [`archive/WRITING_GROUPS.md`](archive/WRITING_GROUPS.md).** User research killed the
> "writing group" model: a fixed, group-chat-style object was confusing and couldn't handle the
> most common behavior — sharing one chapter with a specific person outside any fixed group. The
> snapshot-first architecture and the comments design carried over almost unchanged; the *audience*
> model is what changed. The pivot is a net simplification: no group object, no membership, no
> single-group constraint, no join/token flow.

---

## 1. Model

### Core concepts

| Concept | Definition |
| --- | --- |
| **Share** | Author-initiated act that (a) copies one chapter into an immutable **snapshot** and (b) grants one or more recipients access to it. Like hitting "Share" in Google Docs. |
| **Shared chapter** | The snapshot. One per chapter — re-sharing updates it in place. Owned by the author; carries a copy of book identity so recipients can render a row without touching the author's live data. |
| **Recipient / grant** | A `(shared chapter, person)` access grant, addressed by email. Existing users get access immediately; unknown emails become **pending** and are redeemed on signup/login. |
| **Shared conversation** | All comments on a shared chapter, visible to the author **and every recipient** (Docs-style). Not per-recipient silos. |
| **Comment** | Anchored to a highlighted range inside one shared scene, and to the live scene by id. Not threaded in v1. |

There is **no group object**. Access is a flat many-to-many between chapters and people. Two people
who both have chapter X shared with them are not "in a group" — they simply both see X and its comments.

### Snapshot, not live — the load-bearing decision (unchanged)

Sharing copies the chapter's scene text into `shared_scenes`. Recipients never read the author's live rows.

Why (all still true):
- **Comment anchors stay valid forever.** Character offsets into immutable text can't drift. Anchoring into a document the author is actively editing is the hardest part of this feature; snapshotting deletes the problem.
- **Readers see a stable draft** — "the draft you sent," not a document mutating mid-read.
- **RLS stays simple.** Recipients get zero access to `books`/`chapters`/`scenes`. The only cross-user read path is the snapshot tables, which have no relationship to the live editor.
- **It matches how sharing a draft works** — you circulate a fixed copy, then choose when to send an updated one.
- **It's the same primitive public sharing will need.** Authors write live and choose when to share a snapshot; the audience sees snapshots the author updates at their discretion. This feature is that mechanism with a private, per-person audience — so public sharing later is a new audience, not a new architecture.

Cost: re-sharing is a real operation with real semantics (see §7).

### The snapshot keeps the live scene's identity (unchanged)

`shared_scenes.scene_id` points back at the live `scenes` row. Snapshotting copies the *text*, not the
identity. This is what lets comments surface inside the author's live editor (§3.6): the comment→live-scene
join survives every edit. Only the character offsets can go stale, and the editor's comment UI is a list
that doesn't depend on them.

### One snapshot, many recipients — the shape of the pivot

The old model scoped a snapshot to a group. Here, **one chapter has one snapshot**, and the snapshot is
shared with an arbitrary set of people:

- First share → snapshot is created, recipients added, emails sent.
- Adding a recipient later → a new grant row only; they see the **current** snapshot. No re-snapshot.
- "Update shared copy" → re-snapshots in place (the republish equivalent, §7). Everyone shared sees the update; stale comments handled as before.
- Because everyone shares the one snapshot and one comment thread, "everyone shared sees all comments" falls out for free — no per-recipient duplication.

---

## 2. Schema (migration `010_chapter_sharing.sql`)

```
shared_chapters                                     -- the snapshot; one per live chapter
  id, chapter_id (FK on delete set null), owner_id,
  book_id,                                          -- reference back to the live book
  book_title, cover_path,                           -- SNAPSHOT of book identity (row display)
  chapter_title,                                    -- snapshot
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
```

`shared_chapter_reads` does double duty: **no row = unread shared chapter**; `comment.created_at >
last_seen_at` = unread comment. One table covers both notification sources, from both surfaces (the
`/shared` read view AND the editor Comments tab). Note that with a shared conversation, unread-comment
state now matters for **everyone with access** — the author *and* recipients — not just the book owner.

`shared_chapters.updated_at` bumps on every re-share; `comments.snapshot_version` records which generation
a comment's offsets were captured against. A comment whose `snapshot_version` is behind the current
generation AND whose `quote_text` no longer appears is *stale* (§7) — distinct from a comment that simply
can't be located in the author's live edits, which is normal (§3.6).

### No tokens — redeem by email match

Pending shares (email → no account yet) are redeemed by **email match at signup/login**: when a session's
email equals a `chapter_shares.recipient_email` with a null `recipient_id`, fill in `recipient_id` and
`accepted_at`. No per-share token to mint, carry through email confirmation, or expire. The share email
simply deep-links to `/shared` (or the chapter); the normal auth gate (`?next=`) handles logged-out and
no-account cases. This is strictly simpler than the old invite-token machinery it replaces.

### RLS

One access predicate, reused everywhere:

- `has_access(shared_chapter_id)` — you are the `owner_id`, **or** an accepted recipient
  (`exists (select 1 from chapter_shares where shared_chapter_id = $1 and recipient_id = (select auth.uid()) and revoked_at is null)`).
- `shared_chapters` / `shared_scenes`: read if `has_access`; write only by `owner_id`.
- `chapter_shares`: the owner manages grants (insert/revoke); a recipient may read grants on chapters they can access, and may revoke **their own** grant (remove-from-my-list, §7).
- `comments`: read if `has_access`; insert if `has_access`; update/delete if `author_id = uid`; **resolve** (`resolved_at`) only if you are the chapter owner — a separate policy from the author's own update, so the owner can mark done without editing others' words.

**Profiles need a new read policy.** Today it's `own profile` only ([009_perf_indexes_rls.sql:36](supabase/migrations/009_perf_indexes_rls.sql:36))
— recipient chips and comment attribution would render blank otherwise. Add: *you can read the profile of
anyone you share a chapter with, in either direction* — i.e. there exists a `shared_chapters` where
{you own it and they're an accepted recipient} OR {they own it and you're an accepted recipient}. Same migration.

Follow the `(select auth.uid())` InitPlan pattern from migration 009 throughout, and index every FK — this is read-heavy.

### Sanitization is not optional (unchanged)

Scene bodies are raw `innerHTML` harvested from a contenteditable ([CenterColumn.tsx:318](components/CenterColumn.tsx:318)).
Today that string only renders back into its own author's browser. Sharing makes it render in **someone
else's** browser — a genuine XSS boundary the app has never had.

Sanitize server-side, at share time, into `shared_scenes.body_html`. Allowlist matches what the editor and
docx import emit: `em`, `i`, `strong`, `b`, `br`, `div`, `p`. No attributes at all. Anything else is
stripped to text. Never sanitize only on render.

### Identity, and rendering someone else's cover

`profiles` is `id, display_name, pen_name, created_at` — **no avatar column**; `pen_name` is nullable,
`display_name` enforced at signup.

- **Recipient chips, recent-partner list, comment attribution:** `display_name`.
- **Read-view / feed book credit:** `pen_name || display_name`.
- **Avatars:** none exist. v1 uses **initials in a circle**. A real avatar-upload feature is its own small project; comment cards, recipient chips, and recent-partner chips must all use the identical avatar component so it's built once.
- **Cover images:** `cover_path` is a Supabase Storage path. Recipients have no access to the author's book rows, so covers on the `/shared` feed must be served via a **server-generated signed URL** keyed off the snapshot's `cover_path` — reuse the existing signed-URL approach (mind the expiry fix already shipped for library images). Books with no cover fall back to the same placeholder the Book Panel uses.

---

## 3. Surfaces

### 3.1 Account menu ([LeftColumn.tsx:1038](components/LeftColumn.tsx:1038))

New row above `Account`, label **"Shared with you"**, with a count badge (§6). No shares yet → the row
still shows and routes to the empty `/shared`. (There's no "create a group" onboarding anymore — sharing
starts from a chapter, not from this row.)

### 3.2 `/shared` — the Shared With You feed

A **flat, chronological list** of individual chapters shared *with me*, newest first. No book grouping, no
group object, no member list. Each row: book cover (signed URL), chapter title, book title, author
(`pen_name || display_name`), relative time, unread dot. Click a row → the read view (§3.4).

- **No left column, no right column** in v1. Return to the editor via the same `← Back to Hot Cocoa` nav used elsewhere.
- Empty state per §9.
- This page shows only chapters shared **with** you. Chapters **you** share are managed from the editor (§3.5), not listed here.

### 3.3 Chapter editor `•••` — unchanged

The chapter menu ([LeftColumn.tsx:765](components/LeftColumn.tsx:765)) is **not** touched by this feature.
Sharing is not a menu item — it lives in the right column (§3.5). (This removes the old plan's `ChapterMenu`
extraction and its `Publish`/confirm-modal item entirely.)

### 3.4 Read view — `/shared/[sharedChapterId]`

A **single** shared chapter. No Book Panel, no book-order arrows, no sibling-chapter navigation — the feed
is flat, so each entry stands alone.

- **Center:** prose. `font-serif text-manuscript-l indent-9`, `max-w-[700px]` — identical typography to the editor so the draft reads the way it was written. Scenes render as continuous prose separated by a scene-break mark. Scene **labels are hidden** (author workspace metadata, not the draft).
- **Minimal header** above the prose: book title, chapter title, author name. No editable controls.
- **Right column:** comments (§3.7 read-view comments).
- **Not shown:** the chapter Library (images, notes, music, links) — the author's workspace, not the draft. No left column at all.
- `← Back` returns to `/shared`.

### 3.5 Share component + Share modal — the new entry point (editor right column)

The author shares from **where they write**. A **Share control sits in the Write page's right column, in
the header row next to the Library / Comments tab icons** (the "comment panel header"). It reflects state
at a glance — unshared vs. "Shared with N" — and opens the **Share modal**.

**Share modal** (replaces the old publish-confirm *and* invite modals):

- **Recipient input** — type an email to add someone. Enter/comma commits a chip.
- **Recent share partners** — a quick list of the author's most-recent recipients (distinct across all their `chapter_shares`, most recent first), rendered as tappable avatar+name chips. One tap adds them.
- **Current recipients** — who this chapter is shared with now: avatar, name (or raw email if still pending), a "pending" hint for unredeemed emails, and an `×` to **revoke** that person's access.
- **Snapshot semantics, stated plainly** — recipients see a snapshot; the author can update it or stop sharing.
- **Primary action:**
  - *First share* → snapshot the chapter, create `chapter_shares` rows, send share emails.
  - *Add recipient later* → grant row + email only; no re-snapshot (they see the current copy).
  - *Update shared copy* → re-snapshot in place (§7); warns that comments on changed text will be marked stale. Offered only when the chapter is already shared and the live text has diverged.
- **Stop sharing** → revokes all grants (§7).

The modal is the single management surface for a chapter's sharing. There is deliberately **no reshare from
the recipient side** — recipients read and comment; they don't forward.

### 3.6 Comments in the live editor — Comments tab (unchanged in substance)

Comments must reach the author where they work: the live Chapter Editor.

**Entry point.** A Comments tab icon at the top of the right column, **next to the Library icon** (and now
alongside the Share control, §3.5). Clicking it swaps the Library's content for Comments content — same
column, toggled content, not a new panel. The tab carries its **own dot**: unread comments on the
*currently open* chapter.

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
- **Resolve works from the editor.** Read → revise → check off is the whole loop. Permissions identical to §3.7.
- After a re-share, comments whose quote no longer appears collapse under "Show N from previous version."

### 3.7 Comments column (read view)

Highlight text → on `mouseup`, a blank comment card appears in the right column, focused, at the top of the
highlighted range.

**Positioning.** Each card wants `top = anchorRect.top − containerTop`. Sort by (scene position,
`quote_start`), then cascade: `top = max(desiredTop, prevBottom + gap)`. Downward-only in v1.

**Permission states** — four visual states to design. Because the conversation is shared, **recipients see
each other's comments** (read-only), not just their own:

| Situation | Affordances |
| --- | --- |
| Your comment | tap to edit, `×` to delete |
| You own the chapter, someone else's comment | check to mark done (resolve) |
| Not your chapter, not your comment (another recipient's) | read-only |
| Resolved | collapsed / dimmed, behind a "Show N resolved" toggle |

The chapter owner can resolve but **cannot delete or edit** others' comments. That boundary is what keeps
sharing trustworthy.

**No replies in v1.** Design the card so a reply affordance can be added later without a redesign.

---

## 4. Getting access (replaces the old invite flow)

There is no group to join. A recipient reaches a shared chapter through the share email or the `/shared` feed:

1. Author shares to an email → `chapter_shares` row.
   - Email maps to an existing account → `recipient_id` set immediately; access is live.
   - Email has no account → row is **pending** (`recipient_id` null).
2. Share email deep-links to `/shared` (or directly to `/shared/[sharedChapterId]`).
3. **Logged in** → lands on the target.
4. **Logged out** → `/login?next=…` → target.
5. **No account** → `/signup?next=…`; on completing signup, all pending shares matching the new account's email are redeemed (`recipient_id` + `accepted_at` filled) and the target resolves.

No tokens, no expiry, no single-use juggling, and no "already in a group" screen — those constraints
belonged to the group model and are gone.

---

## 5. Email

Resend is already configured for this project **as Supabase custom SMTP** ([DEPLOYMENT.md:14](DEPLOYMENT.md:14)),
which only carries Supabase Auth's own templates. It cannot send app-authored mail. So this feature adds:

- the **`resend` npm package** (app-level API client) — *approved, add it*,
- a **`RESEND_API_KEY`** in `.env.local` + Vercel — Scott mints the key,
- a `lib/email/` module with the template(s).

**Transactional email: "{Author} shared a chapter with you."** One template, sent to each newly added
recipient, naming the book + chapter and deep-linking to `/shared/[sharedChapterId]`. Works for both
existing users and pending (no-account) recipients — the auth gate handles the rest. Needs a footer
unsubscribe link and a per-user notification preference — cheap now, painful to retrofit.

Open item for Scott: confirm the From address for share mail (`noreply@hotcocoa.app` matches signup; a
repliable address may read better for a personal "someone shared with you" note).

Comment activity stays in-app (dots/badges, §6) in v1 — no per-comment email.

---

## 6. Notifications

Badge count on the account-menu "Shared with you" row = distinct unread items **for you**:
- Chapters shared with you that have no `shared_chapter_reads` row yet
- Chapters you have access to (as owner **or** recipient) with comments newer than your `last_seen_at`

Dots (not counts):
- On the account-menu row's `•••`/affordance
- On the editor's **Comments tab**, scoped to the open chapter (§3.6)

Opening a chapter in the read view **or** opening the editor Comments tab upserts `last_seen_at = now()`.

---

## 7. Edge cases — all resolved

| Case | Resolution |
| --- | --- |
| **Re-sharing ("Update shared copy")** | Replaces the snapshot in place; bumps `shared_chapters.updated_at` (generation). Comments keep their `shared_scene_id` anchor; if `quote_text` no longer appears in the new body, the comment renders **stale** — visible, attributed, unhighlighted. No versioning in v1. |
| **Adding a recipient after commenting has started** | New grant only. They immediately see the current snapshot **and the existing shared conversation** — it's one thread, not a fresh silo. |
| **Author revokes one recipient** | Sets `chapter_shares.revoked_at`. That person loses access. Their existing comments **persist**, still attributed, still visible to everyone else with access. |
| **Author stops sharing entirely** | Revokes all grants and deletes the snapshot + its comments (nothing left to reference). Distinct from revoking one person. |
| **Recipient removes it from their list** | A recipient may revoke **their own** grant ("Remove from Shared with you"). Removes it from their feed; does not affect others. |
| **Author deletes the live chapter** | Snapshot survives (`chapter_id` FK `on delete set null`). The delete modal gains an **"also stop sharing this chapter" checkbox, defaulted UNCHECKED**, shown **only when the chapter is currently shared**. Unchecked keeps what recipients already read + commented on. |
| **Recipient signs up after being shared to** | Pending grant redeemed by email match at signup/login (§4). |
| **Mobile read view** | Comment column becomes inline markers that open a bottom sheet. |

The old group-only cases — "last member leaves," "anyone can remove anyone," "renaming the group" — no
longer exist.

---

## 8. Stages

Each stage is independently shippable and reviewable. Dropping the group object collapses the old Stage 1
entirely, so this is four stages, not five.

### Stage 1 — Share & read (the MVP)
Migration `010_chapter_sharing.sql` (`shared_chapters`, `shared_scenes`, `chapter_shares`, `shared_chapter_reads`
placeholder, profiles read policy, RLS) + server-side sanitizer + snapshot/share action. `resend` package +
`lib/email/` + the "shared a chapter with you" email. The **right-column Share control + Share modal**
(recipient input, recent-partner quick list, current recipients with revoke, first-share/add/update/stop).
Email-match redemption (§4). `/shared` flat feed. `/shared/[sharedChapterId]` read view (prose + minimal
header). Account-menu "Shared with you" row (no badge yet). Initials-circle avatar component. Signed-URL
covers on the feed.

*Ships:* share a chapter with a specific person by email and have them read it — the whole point of the pivot, useful even before comments.

### Stage 2 — Comments (both surfaces)
`comments` table + RLS. **Read view:** highlight-to-comment, offset anchoring, right-column positioning +
stacking, all four permission states (incl. other-recipient read-only), edit/delete/resolve. **Editor:**
Comments tab next to the Library icon, tier-1 grouping + tier-2 opportunistic highlight, resolve from the editor.

*Ships:* the feedback loop, reaching the author where they write.

### Stage 3 — Notifications
`shared_chapter_reads`. Row badge, row dot, Comments-tab dot — scoped so unread-comment state works for
owner and recipients alike. Notification preference + unsubscribe on the share email.

### Stage 4 — Edges & polish
Update-shared-copy / stale comments. Delete-chapter modal's "also stop sharing" checkbox. Revoke one /
stop sharing all / remove-from-my-list. "Show N from previous version" grouping. Mobile read view + comment
sheet. Resolved-comment display. Empty states throughout.

---

## 9. Figma screens needed

Roughly stage-ordered, so design can run one stage ahead of build.

**Stage 1** — account menu with the "Shared with you" row · `/shared` empty state · `/shared` populated
flat feed (row = cover, chapter title, book title, author, time, unread dot) · single-chapter read view
(prose + minimal header) · read-view empty/placeholder · **the right-column Share control** (unshared vs.
"Shared with N", beside the Library/Comments tab icons) · **Share modal** (recipient input, recent-partner
quick-list chips, current recipients with pending state + revoke `×`, first-share vs. update-copy vs. stop-sharing states) · initials-circle avatar · "shared a chapter with you" email

**Stage 2** — read-view comment composer in focus · comment card in all four permission states (incl. another recipient's, read-only) · resolved/collapsed state · stale-comment state · stacking with many comments · **editor right column with Library / Comments tabs + Share control** · Comments-tab list grouped by scene · in-editor highlight state · "unlocatable vs. stale" treatments

**Stage 3** — badge treatments (row count · row dot · Comments-tab dot) · notification preferences

**Stage 4** — delete-chapter modal with "also stop sharing" checkbox · update-shared-copy confirm · revoke / stop-sharing / remove-from-my-list confirms · mobile `/shared` feed · mobile read view · mobile comment sheet

---

## 10. Build note

`AGENTS.md`: this is Next.js 16.2.6 with breaking changes from training data. Read the relevant guide in
`node_modules/next/dist/docs/` before writing route handlers, dynamic route params, or metadata for any new
page (`/shared`, `/shared/[sharedChapterId]`) in this feature.
