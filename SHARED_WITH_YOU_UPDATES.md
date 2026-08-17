# Shared With You — updates & polish

Fast-follow work on the shipped [Shared With You](SHARED_WITH_YOU.md) feature (Stages 1–3 shipped, Stage 4
partial). This doc organizes the punch-list into **stages of bite-sized PRs**. It is the working plan;
[SHARED_WITH_YOU.md](SHARED_WITH_YOU.md) stays the canonical feature spec — when an item here changes a
decision recorded there, update the spec in the same PR.

## Readiness legend

| Mark | Meaning |
| --- | --- |
| ✅ | Ready to build — design + assets settled |
| 🎨 | **Blocked on design** — needs a Figma frame before build |
| 🎨↑ | Design in progress |
| 📦 | **Blocked on assets** — waiting on new icon SVGs |
| 🤔 | **Needs a decision** — open product question, not yet buildable |

Figma source of truth: **Hot Cocoa** (`e4DJxj1g7GTcfUpMaMOvVe`). Frame links inline per item.

---

## Stage overview

| Stage | Theme | Gate |
| --- | --- | --- |
| **5** | Quick wins & bug fixes | ✅ **shipped** (PR #75) |
| **6** | Read view — match new design | ✅ **shipped** (PR #76); 6.4 still 🎨 |
| **7** | Comment card polish | ◐ **shipped** (PR #77); 7.6 📦 / 7.7 🎨↑ |
| **8** | Chapter Menu redesign | ◐ **shipped** (PR #78); 8.4 🎨 / 8.5 🤔 |
| **9** | Shared page — item redesign + author filter | ✅ **shipped** (PR #79) — folds in 4-C |
| **10** | Read view — interactions & performance | ◐ **shipped** (PR #80); 10.4 no-repro |
| **11** | Deferred spec features (email, recent partners) | ✅ |
| **12** | Backlog — needs decision / needs design | 🤔 / 🎨 |

Stages are ordered so the low-risk, no-dependency work lands first and the design/decision-blocked work
sits at the tail. Within a stage, each **PR** is independently shippable and reviewable.

### Remaining after Stages 5–10 (all merged)

- **Blocked on design/assets:** 6.4 scene divider (🎨), 7.6 new icons (📦), 7.7 Edit Comment redesign (🎨↑),
  8.4 Chapter Menu floating button (🎨).
- **Needs a decision:** 8.5 reconcile the two ••• menus (🤔), Stage 12 backlog — self-share/preview and
  live comments/presence (🤔).
- **Needs a repro:** 10.4 read-view over-scroll (couldn't reproduce; scroll tracks content in testing).
- **Stage 11 shipped:** 11.1 comment notification emails (leading-edge, this PR), 11.2 recent share partners.

---

## Stage 5 — Quick wins & bug fixes  ✅ built (one bundled PR)

Small, self-contained, no design dependency. Shipped as a single `stage-5-quick-wins` branch.
All six verified locally (typecheck clean; behaviors confirmed in the browser preview).

### PR 5.1 — Chapter Menu badge dot fires with no new comments ✅
The Chapter Menu badge (dot) still shows when there are no new comments to look at. Bug in the unread
predicate feeding the mini-menu / launcher dot — see the §6 "known gap" and dot placement notes in the spec.
Tighten so the dot only lights on genuine unread state.

### PR 5.2 — Comments-tab load flash from Library tab ✅
Switching to the Comments tab from the Library tab shows a load flash. Fix the transition so switching tabs
doesn't blank/re-mount the column (likely a keyed remount or unguarded loading state).

### PR 5.3 — Library ↔ Comments tab navigation (desktop Write) ✅
**Desktop only** (mobile keeps its X-to-return-to-Write header, unchanged). Spec as built:
- Library active → Library icon on the **left**; the Comments icon on the **right** (only when the chapter
  is shared — no Comments icon otherwise).
- Clicking Comments cross-slides the columns: Library slides left + fades out (200ms ease-in-out), Comments
  slides in from the right + fades in; the Comments icon moves to the **left** and an **X** appears on the right.
- The X reverses it all, back to Library.
- The active (left) icon keeps its collapse-toggle role; both panes stay mounted through the slide (which
  also fixes a latent image-thumbnail re-flash on returning to Library). Comments' read-cursor is gated on
  visibility so unread badges don't clear while it sits mounted behind the Library.
- **Deviation to confirm:** the header icon does an instant swap between sides rather than physically
  sliding across the row; the *content* cross-slides per spec. Flag if the icon-slide is wanted.

### PR 5.4 — Book Panel icon needs a pointer/hand cursor ✅
The Book Panel icon isn't getting a hand (pointer) cursor as a click target. Add the pointer affordance.
*(Separate from the Shared feature, bundled here as a one-liner.)*

### PR 5.5 — Books grid: 4 across on desktop ✅
The Books grid should be 4 across on desktop. Adjust the responsive grid columns.
*(Separate from Shared; small.)*

### PR 5.6 — "How to Use Hot Cocoa" (Tips) opens in a new tab ✅
The How to Use Hot Cocoa page opens in a new tab; it probably shouldn't, since it carries the Workspace Nav
Panel. Change it to navigate in-place. *(Separate from Shared. See [[tips-feature]].)*

---

## Stage 6 — Read view: match the new design  ✅ 6.1–6.3 shipped (PR #76)

All anchored to the Read Header / Read layout frame:
[297-26346](https://www.figma.com/design/e4DJxj1g7GTcfUpMaMOvVe/Hot-Cocoa?node-id=297-26346). These touch
the same surface — sequence 6.1 → 6.4 to avoid churn.

> **Deferred from this stage** (not in the three items, flagged during build): the left column's
> **"hot cocoa" + ••• footer** (overlaps the two-••• question, #31 / Stage 8) and the **default grid**
> chapter layout (that's Stage 10.5's grid-styling item). 6.3 also folded in the read-rail collapse toggle.

### PR 6.1 — Read Header style update ✅
Restyle the Read view header to match the frame.

### PR 6.2 — Remove Book Overview from the Read left column ✅
Redundant with the Read Header. Remove the Book Overview section from the read view's left column (the
read-only Book Panel per spec §3.3), keeping cover/title/author where the header now carries them.

### PR 6.3 — Move the Comments tab icon into the right column ✅
Move the Comments tab icon out of the Read Header and into the right column, matching the design. *(Read-view
counterpart to the editor's Library/Comments tab placement, spec §3.7.)*

### PR 6.4 — Scene divider `***` mark 🎨
Read now shows a scene-divider `***` thing that needs a design pass. Blocked on a Figma update for the
scene-break mark before we finalize styling.

---

## Stage 7 — Comment card polish  ◐ 7.1–7.5 shipped (PR #77); 7.6/7.7 blocked

The comment card gets a behavioral + visual overhaul. **Note:** 7.1 intentionally reverses two behaviors
shipped in Stages 2 & 4 — update spec §3.4 / §3.7 / §7 accordingly.

> **Built & verified** (both surfaces, editor `EditorComments` + read-view `ReadComments`): flat all-comments
> list, no toggles; composer + cards carry the author line; no quote snippet; no scene labels; composer uses
> Cancel/Save (checkmark reserved for resolve). Read-view **stale** comments (which can't anchor to changed
> prose) still list in a small always-shown group at the top of the rail — the one place "show all" can't be
> a pure inline cascade. **Not done:** 7.6 (icons — assets), 7.7 (edit-state redesign — Figma in progress);
> the current inline edit keeps its existing Cancel/Save until 7.7's frame lands.

### PR 7.1 — Show all comments; drop the "previous version" and "resolved" toggles ✅ built
- Remove "**Show N from a previous version**" (stale) grouping — just show all comments. If a comment no
  longer applies, the author deletes it.
- Remove the "**Show N resolved**" toggle — just show all comments.
- Applies to **both** surfaces (editor Comments tab + read view).
- **Spec impact:** reverses the Stage 4-A stale-grouping and the Stage 2 resolved-toggle. Reconcile §3.4
  (resolved row), §3.7 (previous-version collapse), and §7 (stale rendering) in this PR.

### PR 7.2 — Cancel/Save buttons; checkmark = resolve only ✅ built
Add small **Cancel / Save** buttons to all comment states. The checkmark in the top-right of the card is
**only** for marking a comment resolved — it must not double as save/confirm for any other action.

### PR 7.3 — Every comment shows the author profile line ✅ built
Adding a comment always needs the author profile line, per
[297-26483](https://www.figma.com/design/e4DJxj1g7GTcfUpMaMOvVe/Hot-Cocoa?node-id=297-26483). Ensure the
composer / new-comment state renders the avatar + name line, not just existing cards.

### PR 7.4 — Remove the quoted text snippet from comments ✅ built
Remove the text snippet (quoted range) from the comment card, matching the design.

### PR 7.5 — Remove Scene Descriptions from the comment panel ✅ built
Remove the scene-description labels from the comments panel.

### PR 7.6 — New comment-tab / re-open icons 📦
Swap in the new icon SVGs (Comment Tab, Re-open Comment, etc.) once uploaded. Blocked on assets. *(May
unblock finishing touches in 7.2 and Stage 6.)*

### PR 7.7 — Edit Comment redesign 🎨↑
New design in progress for the Edit Comment state. Build once the Figma frame lands. *(Coordinate with 7.2
so the Cancel/Save affordance matches the final edit design.)*

---

## Stage 8 — Chapter Menu redesign  ◐ 8.1–8.3 shipped (PR #78); 8.4/8.5 deferred

Rework the bottom-right `•••` sharing mini-menu (spec §3.6) into a full **Chapter Menu** matching
[297-26768](https://www.figma.com/design/e4DJxj1g7GTcfUpMaMOvVe/Hot-Cocoa?node-id=297-26768).

> **Built & verified** (`SharingMenu.tsx`, all 5 states confirmed in preview): State 1 (Share + Delete
> chapter), State 2 (SHARED row + up to 3 avatars + Update + Stop sharing + Delete chapter), and the Update
> lifecycle 3→4→5 (Updating spinner → Updated ✓ → back to State 2 after 1600ms; error line on failure). The
> "Update" no longer shows a "previous version" warning — Stage 7 removed that concept. Stop sharing keeps a
> two-tap confirm (destructive). Extracted a shared `ConfirmModal` + new styled `Checkbox` (ui/) used by both
> the Chapter Menu's delete flow and the left-panel kebab's, so 8.3's checkbox is consistent in both.
> **Menu width:** used `w-48` (the Account Menu is `w-40`, too narrow for the buttons + avatars + error line)
> — same panel/border/divider *style* as the Account Menu, slightly wider. **Note:** the Chapter Menu now
> carries **Delete chapter** as designed, which duplicates the left-panel "Section options" kebab's delete —
> that duplication is exactly what **8.5** will reconcile (deferred per Scott).

### PR 8.1 — Chapter Menu shell + states 1–2 ✅ built
- Match the **width and style of the Account Menu**.
- **State 1 (Not shared):** Share button + Delete Chapter; Share opens the Share modal.
- **State 2 (Shared):** a Shared row with up to **3 partner profile-picture thumbnails**, an Update button,
  and a Stop Sharing button.

### PR 8.2 — Chapter Menu update lifecycle: states 3–5 ✅ built
- **State 3 (Updating):** Update button with a small animated loading spinner.
- **State 4 (Updated):** success confirmation that returns to State 2 after **1600ms**.
- **State 5 (Error):** general error-message template.

### PR 8.3 — Style the "also stop sharing" checkbox (Delete Chapter) ✅ built
Style the sharing checkbox in the Delete Chapter modal (shipped in Stage 4-B, currently unstyled).

### PR 8.4 — Chapter Menu as a floating button 🎨
The Chapter Menu currently sits under a horizontal divider line in the panel. It should be a **floating
button that doesn't interfere with the rest of the panel**. Needs a design pass before build.

### PR 8.5 — Rectify the two `•••` menus 🤔
There are now two different `•••` menus. Decide how they consolidate (or how they visually differentiate)
before building. Needs a product decision. *(Depends on 8.1/8.4 landing first.)*

---

## Stage 9 — Shared page: item redesign + author filter  ✅ shipped (PR #79)

> **Built & verified** (`app/(workspace)/shared/page.tsx`, `lib/shared/feed.ts`): the feed item is now a card
> — chapter + book on the left; author avatar + name (desktop only), unread pill, time, and a ••• on the
> right — with the cover thumbnail dropped per the frame. The Author Filter row renders when there are ≥2
> authors, with the three chip states (default / NEW-unread / selected-ring) and single-select behavior
> (click again to clear, click another to switch), filtering the feed client-side. Added `authorId` to
> `FeedItem` as the grouping key. **Folded in Stage 4-C** (remove-from-my-list): the item's ••• →
> "Remove from Shared with you" hits a new `DELETE /api/shared/[id]` that revokes the reader's own grant
> (RLS "recipient revokes own"); the item drops optimistically.

### PR 9.1 — Shared Chapter Item redesign ✅ built
Update the Shared Chapter Item (feed row, spec §3.2) to match
[297-26576](https://www.figma.com/design/e4DJxj1g7GTcfUpMaMOvVe/Hot-Cocoa?node-id=297-26576). Card layout, no
cover, author on desktop only; mobile shows chapter/book + time + ••• only.

### PR 9.2 — Author Filter row (new feature) ✅ built
Author Filter row on `/shared` — chip states from
[297-26797](https://www.figma.com/design/e4DJxj1g7GTcfUpMaMOvVe/Hot-Cocoa?node-id=297-26797), row placement
from [297-25617](https://www.figma.com/design/e4DJxj1g7GTcfUpMaMOvVe/Hot-Cocoa?node-id=297-25617). One author
selected at a time (click same to deselect, different to switch); NEW badge when that author has an unread
chapter in your list; filters client-side. Shown only with ≥2 authors.

---

## Stage 10 — Read view: interactions & performance  ◐ 10.1–10.3, 10.5 shipped (PR #80); 10.4 not reproduced

Read-mode UX parity with the Write editor, plus perf. Independent PRs.

> **Built & verified** (`app/shared/[sharedChapterId]/page.tsx`): sibling prefetch + a module-level read-view
> cache (instant chapter-to-chapter nav); ←/→ arrow-key chapter navigation with the on-screen arrows removed;
> resizable left Book Panel via `useColumnResize` (persisted `hc.read.leftWidth`); chapter grid restyled to
> the writer's tiles. **10.4 could not be reproduced** — see below.

### PR 10.1 — Background-fetch sibling chapters in the same book ✅ built
After a chapter loads, prefetch the reader's other accessible chapters of the book into a module-level cache;
a revisit seeds from cache (instant) then revalidates. Verified: ←/→ navigation renders the sibling with no
skeleton.

### PR 10.2 — Arrow-key chapter navigation; remove the arrow UI ✅ built
Removed the on-screen prev/next arrows; added a window ←/→ handler that moves between the reader's accessible
chapters in book order (ignored while typing / with modifiers). Spec §3.3 updated (arrows → arrow keys).

### PR 10.3 — Resizable panels (match Write) ✅ built
Left Book Panel is drag-resizable via the same `useColumnResize` + divider the writer uses (min 200, max 440,
persisted). **Scoped to the left panel:** the comments rail lives *inside* the shared prose scroll (so cards
track the text), which makes an in-scroll resize divider a poor fit — it keeps its fixed width + collapse
toggle from Stage 6. Flag if the rail should be resizable too.

### PR 10.4 — Page scrolls far past chapter content ◐ not reproduced
Measured on a long and a short chapter: the scroll extent equals the content (or the viewport, via
`min-h-full`, for a short chapter) — no dead space. The only way to exceed the prose is bottom-anchored
comment cards, which are themselves content. Left as-is rather than risk regressing correct behavior; **needs
a specific repro** (likely many comments clustered at a chapter's end) to action.

### PR 10.5 — Chapter grid view matches Write styling ✅ built
Grid now mirrors the writer's cells — `grid-cols-3`, `aspect-[3/4]` tiles, `text-[9px]` centered truncated
label, current chapter elevated + accent border. Keeps its own `hc.sharedBookView` list/grid key (§3.3).

---

## Stage 11 — Deferred spec features

Carried over from [SHARED_WITH_YOU.md](SHARED_WITH_YOU.md) Stage 4 fast-follow.

### PR 11.1 — Comment notification emails ✅ built
Email a chapter's **author** when a reader comments (spec §5). **Trigger model (confirmed with Scott):**
*leading-edge* debounce — the email fires on the **first** comment of a commenter's session and links straight
to the chapter, then stays silent for a **2-hour cooldown** per `(chapter, commenter)`. No comment content or
count; the link (`/shared/[id]`, which the owner can open) already shows everything. This matches how writing
groups comment — async, on their own schedules — without a per-comment blast, and needs no sub-daily cron
(which Vercel Hobby lacks): the cooldown is a timestamp check, not a scheduled send.

> **Built:** migration 017 (`profiles.notify_on_comment` + a service-role-only `comment_notifications` cooldown
> ledger); `lib/email/commentEmail.ts` (clone of `shareEmail.ts`); `lib/shared/commentNotify.ts` orchestrates
> gate + cooldown + send through the service-role client; wired into `POST /api/comments` via `after()` so it's
> off the response path and never fails a comment. New **Settings → Notifications › Comments** toggle;
> `/unsubscribe?pref=comment` splits the unsubscribe so muting comments doesn't mute shares. Peer-recipient
> notifications (readers hearing about each other's comments) deferred to the live-comments backlog.

### PR 11.2 — Recent share partners in the Share modal ✅ built
A **Recent** list in the Share modal (between the email input and Shared with) — the distinct people the
author has shared any chapter with, newest first, each with a one-tap **Share** button. Matches the attached
frames' three states (grows Shared with / shrinks Recent as you share).

> **Built:** `lib/shared/recent.ts` (`getRecentPartners` — distinct recipients across the author's snapshots
> from `chapter_shares`, avatars signed service-side); `GET /api/share/recent`; `RecentPartner` type; the modal
> fetches on mount, filters out anyone already on the chapter (incl. this-session adds), hides when empty, and
> Share reuses the proven `POST /api/share` path. Verified State 1 live in the writer (real partners rendered);
> did not fire a real share on Scott's live book (would email a real person + snapshot the chapter).

---

## Stage 12 — Backlog: needs decision / needs design

Not yet buildable. Parked here so they aren't lost; promote into a stage once resolved.

### Sharing a chapter with myself / viewing my own book in Read mode 🤔
Showing chapters I've shared in the `/shared` list works, but sharing a chapter **with myself** is wonky.
Bigger question: how do I view my own book in Read mode? A Preview button? A separate control? Needs product
thought before any build.

### Live comments & author presence 🤔
How to handle live comments being added while someone is reading, and author presence. Needs a design +
product decision (realtime subscription? polling? presence indicators?).

---

## Cross-cutting notes

- **Spec reconciliation:** PRs 7.1, 10.2 (and any that alter §-documented behavior) must update
  [SHARED_WITH_YOU.md](SHARED_WITH_YOU.md) in the same PR so the spec never drifts from what shipped.
- **Asset gate:** Stage 7's icon swap (7.6) and the Edit Comment redesign (7.7) are blocked on uploads/Figma;
  don't hold the rest of Stage 7 for them.
- **Build note:** per [AGENTS.md](AGENTS.md), this is Next.js 16.2.6 with breaking changes — read the
  relevant guide in `node_modules/next/dist/docs/` before touching route handlers or metadata.
- **Commit scope:** stage only files you changed ([[scope-commits]]); branch from a freshly-fetched `main`
  ([[fetch-before-branching]]).
</content>
</invoke>
