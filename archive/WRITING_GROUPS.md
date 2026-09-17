> ⚠️ **ARCHIVED — superseded by [`SHARED_WITH_YOU.md`](../SHARED_WITH_YOU.md) (2026-08-10).**
> The "writing group" (group-chat) model was dropped after user research: it confused
> people and made it hard to share a chapter with someone outside your fixed group.
> It's been replaced by per-chapter, per-recipient sharing and a flat "Shared with you"
> feed (Google-Drive-style). Kept for reference — the snapshot/comments architecture
> below carried forward largely intact. Do not build against this file.

---

# Writing Groups — feature spec

Private sharing and commenting. All decisions resolved — this is the spec we build against. Scott is designing screens in Figma from §9.

---

## 1. Model

### Core concepts

| Concept | Definition |
| --- | --- |
| **Writing group** | A flat, shared object. Belongs to everyone in it. No owner, no roles. Group-chat semantics: if you're in, you're in. |
| **Membership** | One group per user in v1 (enforced by a unique index that we drop when multi-group lands). |
| **Publish** | Author-initiated act that copies one chapter into the group as an immutable **snapshot**. |
| **Shared book** | Created implicitly on a book's first publish. Carries title + cover so the group can see whose book it is. |
| **Comment** | Anchored to a highlighted range inside one published scene, and to the live scene by id. Not threaded in v1. |

### Snapshot, not live — the load-bearing decision

Publishing copies the chapter's scene text into `published_scenes`. The group never reads the author's live rows.

Why:
- **Comment anchors stay valid forever.** Character offsets into immutable text can't drift. Anchoring into a live document that the author is actively editing is the single hardest part of this feature, and snapshotting deletes the problem outright.
- **Readers see a stable draft.** A crit group reads "the draft you sent," not a document mutating under them mid-read.
- **RLS stays simple.** Group members get zero access to `books`/`chapters`/`scenes`. The only cross-user read path is the snapshot tables, which have no relationship to the live editor.
- **It matches how writing groups actually work.** You circulate a draft.
- **It's the same primitive public sharing will need.** Authors write in a live book and choose when to publish a book/chapter; the world sees snapshots the author updates at their discretion. Writing Groups is that mechanism with a private audience — building it snapshot-first means public sharing is a new audience, not a new architecture.

Cost: re-publishing is a real operation with real semantics (see §7).

### The snapshot keeps the live scene's identity

`published_scenes.scene_id` points back at the live `scenes` row. Snapshotting copies the *text*, not the identity. This is what lets comments made in the group surface inside the author's live editor (§3.7): the comment→live-scene join survives every edit. Only the character offsets can go stale, and the editor's comment UI is a list that doesn't depend on them.

---

## 2. Schema (migration `010_writing_groups.sql`)

Table named `writing_groups`, not `groups` — `GROUPS` is a keyword in window-frame syntax.

```
writing_groups
  id, name (default 'Writing Group'), created_by, created_at

group_members
  group_id, user_id, invited_by, joined_at        PK (group_id, user_id)
  UNIQUE INDEX on (user_id)                        -- v1 single-group; drop later

group_invites
  id, group_id, email (citext), token, invited_by,
  created_at, expires_at, accepted_at, accepted_by

shared_books
  id, group_id, book_id, owner_id,
  title, cover_path,                               -- snapshot of book identity
  created_at                                       UNIQUE (group_id, book_id)

published_chapters
  id, shared_book_id, chapter_id, published_by,
  title,                                           -- snapshot
  book_position,                                   -- snapshot: order within the book
  published_at, updated_at, withdrawn_at
                                                   UNIQUE (shared_book_id, chapter_id)

published_scenes
  id, published_chapter_id, scene_id, position,
  body_html,                                       -- SANITIZED at publish time
  body_text                                        -- plain-text projection; anchors index into this

comments
  id, published_chapter_id, published_scene_id, author_id,
  body,                                            -- plain text
  quote_text, quote_start, quote_end,              -- offsets into published_scenes.body_text
  snapshot_version,                                -- publish generation the quote was made against (see §7)
  created_at, updated_at, resolved_at, resolved_by

published_chapter_reads
  published_chapter_id, user_id, last_seen_at      PK (published_chapter_id, user_id)
```

`published_chapter_reads` is doing double duty and is worth calling out: **no row = unread chapter**; `comment.created_at > last_seen_at` = unread comment. One table covers both notification sources, from both surfaces (group read view AND the editor Comments tab).

`published_chapters.updated_at` bumps on every republish; `comments.snapshot_version` records which generation a comment's offsets were captured against. A comment whose `snapshot_version` is behind the chapter's current generation AND whose `quote_text` no longer appears is *stale* (§7) — distinct from a comment that simply can't be located in the author's live edits, which is normal (§3.7).

### RLS

Two predicates, reused everywhere:

- `is_member(group_id)` — `exists (select 1 from group_members where group_id = $1 and user_id = (select auth.uid()))`
- Author-only writes on `published_*` (only `published_by` can withdraw/republish); member-scoped reads.
- `comments`: read if member of the owning group; insert if member; update/delete if `author_id = uid`; **resolve** (`resolved_at`) if you own the book — a separate policy from the author's own update, so an author can't edit someone's words while marking them done.

**Profiles need a new read policy.** Today it's `own profile` only ([009_perf_indexes_rls.sql:36](supabase/migrations/009_perf_indexes_rls.sql:36)) — a member list would render blank cards and comments would have no author name. Add: *members of a group I'm in can read my profile.* Same migration.

Follow the `(select auth.uid())` InitPlan pattern from migration 009 throughout, and index every FK — this is a read-heavy feature.

### Sanitization is not optional

Scene bodies are raw `innerHTML` harvested from a contenteditable ([CenterColumn.tsx:318](components/CenterColumn.tsx:318)). Today that string only ever renders back into its own author's browser. Publishing makes it render in **someone else's** browser — a genuine XSS boundary the app has never had.

Sanitize server-side, at publish time, into `published_scenes.body_html`. Allowlist is tiny (matches what the editor and docx import actually emit): `em`, `i`, `strong`, `b`, `br`, `div`, `p`. No attributes at all. Anything else is stripped to its text. Never sanitize only on render.

### Profiles / identity

`profiles` is `id, display_name, pen_name, created_at` — **no avatar column**, and `pen_name` is nullable while `display_name` is enforced at signup.

- **Member cards + comment attribution:** `display_name`.
- **Read view book credit:** `pen_name || display_name` — gives pen names their one real job.
- **Avatars:** none exist. v1 uses **initials in a circle**. A real avatar-upload feature is its own small project; comment cards and member cards must use the identical avatar component so it's built once, deliberately, when it comes.

---

## 3. Surfaces

### 3.1 Account menu ([LeftColumn.tsx:1038](components/LeftColumn.tsx:1038))

New row above `Account`, label = the group's name (fallback "Writing Group"), with a count badge (§6). The `•••` trigger button itself gets a **dot** (no number — 20px target). No group yet → the row still shows, and opens the create-a-group flow.

### 3.2 Group page — `/group`

Chronological feed of published chapters, newest first. Each row: book cover, chapter title, book title, author, relative time, unread dot.

- **No left column** in v1. Return to the editor via the same `← Back to Hot Cocoa` nav used elsewhere.
- **No right column.**
- **Center `•••` menu** holds group actions: **Invite** and **Leave group**, plus the **member list**. Members render as cards modeled on the Music Link card — avatar (initials circle) in place of album art, member name in place of song title, no play button, an `×` to remove. Anyone can remove anyone (including the creator); the confirm modal is the only guard, matching group-chat norms.
- **Rename:** group name is inline-editable here; propagates to the account-menu row. Anyone can rename.

### 3.3 Chapter editor `•••`

Same menu as the chapter list right-click ([LeftColumn.tsx:765](components/LeftColumn.tsx:765)). Extract that menu into `components/ui/ChapterMenu.tsx` and render it from both sites — one component, one item list.

Items: `Open side-by-side` (list only, desktop) · **`Publish`** · `Duplicate` · `Delete`.

`Publish` with no group → opens the create-group flow rather than being disabled. Good onboarding path.

### 3.4 Publish confirm modal

Names the chapter and the group, states that the group sees a snapshot, and that the author can withdraw it. Republish variant warns that existing comments on changed text will be marked stale (§7).

### 3.5 Read view — `/group/[sharedBookId]/[publishedChapterId]`

Book-scoped. Shows every published chapter of that book, one at a time.

- **Center:** prose. `font-serif text-manuscript-l indent-9`, `max-w-[700px]` — identical typography to the editor so the author's draft reads the way they wrote it. Scenes render as continuous prose separated by a scene-break mark. Scene **labels are hidden** (author's workspace metadata, not the draft).
- **Left/right arrows** navigate between that book's published chapters in **book order**, not publish order. The feed on `/group` is publish order. Two orderings, deliberately.
- **Left column:** a read-only version of the Book Panel — cover (if any), book title, author name (`pen_name || display_name`), and the published-chapter list. Not editable, but the reader **can** toggle the list/grid view. This toggle needs its **own** localStorage key — the editor's `hc.sectionViews` is keyed by section id, and published chapters are a flat, sectionless list in book order.
- **Right column:** comments (§3.6).
- **Not shown:** the chapter Library (images, notes, music, links) — the author's workspace, not the draft.

### 3.6 Comments column (read view)

Highlight text → on `mouseup`, a blank comment card appears in the right column, focused, positioned at the top of the highlighted range.

**Positioning.** Each card wants `top = anchorRect.top − containerTop`. Sort by (scene position, `quote_start`), then cascade: `top = max(desiredTop, prevBottom + gap)`. Downward-only in v1; Google-Docs-style push-in-both-directions-around-the-focused-card is polish.

**Permission states** — four visual states to design:

| Situation | Affordances |
| --- | --- |
| Your comment | tap to edit, `×` to delete (behaves like a Note) |
| Your book, someone else's comment | check to mark done |
| Not your book, not your comment | read-only |
| Resolved | collapsed / dimmed, behind a "Show N resolved" toggle |

The book author can resolve but **cannot delete or edit** others' comments. That boundary is what makes the group trustworthy.

**No replies in v1.** Backlogged in Linear. Research shows crit groups discuss comments live over video, so replies may matter less than expected — awaiting user feedback. Design the card so a reply affordance can be added later without a redesign.

### 3.7 Comments in the live editor — Comments tab

Comments made in the group must reach the author where they work: the live Chapter Editor.

**Entry point.** A Comments tab icon at the top of the Write page's **right column, next to the Library icon**. Clicking it swaps the Library's content for Comments content (same column, toggled content — not a new panel). The tab carries its **own dot**: unread comments on the *currently open* chapter. This is the author's real discovery path — open a chapter, see the dot, read feedback.

**How it works with snapshots — two tiers off the one `scene_id` link:**

*Tier 1 — grouping (always works).* List this chapter's comments grouped by scene, in scene order, joining `comments → published_scenes.scene_id → live scene`. Each card shows the quoted snapshot text, the comment, and the author. Click → the editor scrolls to that scene (reuses the existing scene-scroll mechanism from the Book Panel scene list). No offset math, never breaks.

*Tier 2 — highlighting (opportunistic).* Search the *live* scene's plain text for `quote_text`. Exactly one match → highlight it in the editor. Zero or multiple matches → no highlight; the card still shows the quote. Recomputed on render, never stored, degrades silently. This gives true in-place anchoring in the window that matters most — right after publishing, before the author has revised — and decays gracefully after.

**Two "unlocatable" meanings, rendered differently:**
- *Can't find the quote in live text* → normal. You revised; that's the point. No warning styling.
- *Stale against a republished snapshot* (§7) → different information; its own subdued treatment.

**Behavior:**
- Opening the tab upserts `last_seen_at = now()` for the open chapter — same `published_chapter_reads` write as the read view, clearing the notification from both surfaces.
- **Resolve works from the editor.** Read → revise → check off is the whole loop. Edit/delete/resolve permissions are identical to §3.6.
- After a republish, comments whose quote no longer appears collapse under "Show N from previous version" — reads like versioning, costs only a display grouping.

---

## 4. Invites

1. Member enters an email → row in `group_invites` with a random token.
2. Email sends a link to `/group/join/[token]`.
3. **Has an account, logged in** → confirm screen → `group_members` row → land on `/group`.
4. **Has an account, logged out** → `/login?next=/group/join/[token]`.
5. **No account** → `/signup?invite=[token]`; the token survives the email-confirm round trip and is redeemed at the end of the profile step.
6. **Already in a group** → explicit "You're already in a writing group" screen. Not an error toast — a real state, because single-group is a v1 constraint people will hit.

Invites expire (14 days). Tokens are single-use.

---

## 5. Email

Two new transactional emails: *invite* and *chapter published*.

**Resend is already set up for this project — but as Supabase custom SMTP** ([DEPLOYMENT.md:14](DEPLOYMENT.md:14)), which only carries Supabase Auth's own templates (signup verification from `noreply@hotcocoa.app`). It cannot send our app-authored mail. So this feature adds:

- the **`resend` npm package** (app-level API client) — *approved, add it*,
- a **`RESEND_API_KEY`** in `.env.local` + Vercel — Scott mints the key,
- one `lib/email/` module with the two templates.

Open item for Scott: confirm the From address for group mail (`noreply@hotcocoa.app` matches signup; invites may read better from a repliable address).

Publish notification: to every member **except the publisher**, deep-links to `/group/[sharedBookId]/[publishedChapterId]`. Needs a footer unsubscribe link and a per-user notification preference — cheap now, painful to retrofit.

---

## 6. Notifications

Badge count on the account-menu row = distinct unread items:
- Published chapters with no `published_chapter_reads` row for you
- Chapters you own with comments newer than your `last_seen_at`

Dots (not counts):
- On the account-menu `•••` button
- On the editor's **Comments tab**, scoped to the open chapter (§3.7)

Opening a chapter in the read view **or** opening the editor Comments tab upserts `last_seen_at = now()`.

---

## 7. Edge cases — all resolved

| Case | Resolution |
| --- | --- |
| **Re-publishing** | Replaces the snapshot in place; bumps `published_chapters.updated_at` (generation). Comments keep their `published_scene_id` anchor; if `quote_text` no longer appears in the new body, the comment renders **stale** — visible, attributed, unhighlighted. No versioning in v1. |
| **Author deletes the live chapter** | Snapshot survives (`chapter_id` FK `on delete set null`). The delete modal gains an **"also unpublish this chapter" checkbox, defaulted UNCHECKED**, shown **only when the chapter is currently published**. Leaving it unchecked keeps what the group already read + commented on; the explicit Withdraw action covers accidental publishes. |
| **Author withdraws a chapter** | Sets `withdrawn_at`. Leaves the feed. Comments retained (restoring restores the conversation). |
| **Member is removed** | Their published chapters are **no longer shown** (withdrawn with them). Their comments **persist**, still attributed. |
| **Member leaves voluntarily** | Same as removal. `Leave group` lives in the group-page `•••` (§3.2). |
| **Last member leaves** | Group and all snapshots deleted. Empty state designed per §9. |
| **Anyone can remove anyone** | Matches the flat model, creator included. Confirm modal is the only guard. |
| **Renaming** | Anyone can rename; propagates to the account-menu row. |
| **Mobile read view** | Comment column becomes inline markers that open a bottom sheet. |

---

## 8. Stages

Each stage is independently shippable and reviewable.

### Stage 1 — Groups & membership
Migration for `writing_groups`, `group_members`, `group_invites` + the profiles read policy + RLS. `resend` package + `lib/email/`. Account-menu row (no badge yet). `/group` shell with `← Back` nav, the `•••` menu (Invite / Leave / member list), create + rename. Invite by email, `/group/join/[token]`, and the three entry paths (logged in / logged out / no account). Initials-circle avatar component.

*Ships:* you can form a writing group. Nothing to share yet.

### Stage 2 — Publish & read
Snapshot tables + server-side sanitizer + publish action. Extract `ChapterMenu`, add `•••` to the chapter editor, add `Publish` + confirm modal. `/group` feed. Read view: prose center, read-only Book Panel (cover/title/author/list+grid toggle), arrow navigation.

*Ships:* the actual "share your writing" MVP — useful on its own even without comments.

### Stage 3 — Comments (both surfaces)
`comments` table + RLS. **Read view:** highlight-to-comment, offset anchoring, right-column positioning + stacking, all four permission states, edit/delete/resolve. **Editor:** Comments tab next to the Library icon, tier-1 grouping + tier-2 opportunistic highlight, resolve from the editor.

*Ships:* the feature as pitched, reaching the author where they write.

### Stage 4 — Notifications
`published_chapter_reads`. Row badge, `•••` dot, Comments-tab dot. Publish emails with deep links. Notification preference + unsubscribe.

### Stage 5 — Edges & polish
Republish/withdraw. Delete-modal unpublish checkbox. Leave/remove flows. "Show N from previous version" grouping. Mobile read view + comment sheet. Resolved-comment display. Empty states throughout.

---

## 9. Figma screens needed

Roughly stage-ordered, so design can run one stage ahead of build.

**Stage 1** — account menu with the Writing Group row · `•••` with dot · `/group` empty state (no group) · create/name group · group page `•••` menu (Invite / Leave / member list) · member card (Music-Link-style, initials avatar, `×`) · invite modal · "already in a group" screen · invite email

**Stage 2** — chapter editor `•••` menu · publish confirm modal (+ republish variant) · `/group` populated feed · read view (prose, read-only Book Panel, list+grid toggle, arrows) · read view empty state

**Stage 3** — read-view comment composer in focus · comment card in all four permission states · resolved/collapsed state · stale-comment state · stacking with many comments · **editor right column with Library/Comments tab icons** · Comments-tab list grouped by scene · in-editor highlight state · "unlocatable vs. stale" comment treatments

**Stage 4** — badge treatments (row count · `•••` dot · Comments-tab dot) · publish notification email · notification preferences

**Stage 5** — last-member empty state · delete-chapter modal with unpublish checkbox · mobile group page · mobile read view · mobile comment sheet · leave/remove confirms

---

## 10. Build note

`AGENTS.md`: this is Next.js 16.2.6 with breaking changes from training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing route handlers, dynamic route params, or metadata for any new page in this feature.
