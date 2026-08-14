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
| **5** | Quick wins & bug fixes | ✅ all ready |
| **6** | Read view — match new design | mostly ✅, one 🎨 |
| **7** | Comment card polish | ✅ + 📦 icons + 🎨↑ edit |
| **8** | Chapter Menu redesign | ✅ core + 🎨/🤔 tail |
| **9** | Shared page — item redesign + author filter | ✅ |
| **10** | Read view — interactions & performance | ✅ |
| **11** | Deferred spec features (email, recent partners) | ✅ |
| **12** | Backlog — needs decision / needs design | 🤔 / 🎨 |

Stages are ordered so the low-risk, no-dependency work lands first and the design/decision-blocked work
sits at the tail. Within a stage, each **PR** is independently shippable and reviewable.

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

## Stage 6 — Read view: match the new design

All anchored to the Read Header / Read layout frame:
[297-26346](https://www.figma.com/design/e4DJxj1g7GTcfUpMaMOvVe/Hot-Cocoa?node-id=297-26346). These touch
the same surface — sequence 6.1 → 6.4 to avoid churn.

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

## Stage 7 — Comment card polish

The comment card gets a behavioral + visual overhaul. **Note:** 7.1 intentionally reverses two behaviors
shipped in Stages 2 & 4 — update spec §3.4 / §3.7 / §7 accordingly.

### PR 7.1 — Show all comments; drop the "previous version" and "resolved" toggles ✅
- Remove "**Show N from a previous version**" (stale) grouping — just show all comments. If a comment no
  longer applies, the author deletes it.
- Remove the "**Show N resolved**" toggle — just show all comments.
- Applies to **both** surfaces (editor Comments tab + read view).
- **Spec impact:** reverses the Stage 4-A stale-grouping and the Stage 2 resolved-toggle. Reconcile §3.4
  (resolved row), §3.7 (previous-version collapse), and §7 (stale rendering) in this PR.

### PR 7.2 — Cancel/Save buttons on every comment state; checkmark = resolve only ✅
Add small **Cancel / Save** buttons to all comment states. The checkmark in the top-right of the card is
**only** for marking a comment resolved — it must not double as save/confirm for any other action.

### PR 7.3 — Every comment shows the author profile line ✅
Adding a comment always needs the author profile line, per
[297-26483](https://www.figma.com/design/e4DJxj1g7GTcfUpMaMOvVe/Hot-Cocoa?node-id=297-26483). Ensure the
composer / new-comment state renders the avatar + name line, not just existing cards.

### PR 7.4 — Remove the quoted text snippet from comments ✅
Remove the text snippet (quoted range) from the comment card, matching the design.

### PR 7.5 — Remove Scene Descriptions from the comment panel ✅
Remove the scene-description labels from the comments panel.

### PR 7.6 — New comment-tab / re-open icons 📦
Swap in the new icon SVGs (Comment Tab, Re-open Comment, etc.) once uploaded. Blocked on assets. *(May
unblock finishing touches in 7.2 and Stage 6.)*

### PR 7.7 — Edit Comment redesign 🎨↑
New design in progress for the Edit Comment state. Build once the Figma frame lands. *(Coordinate with 7.2
so the Cancel/Save affordance matches the final edit design.)*

---

## Stage 8 — Chapter Menu redesign

Rework the bottom-right `•••` sharing mini-menu (spec §3.6) into a full **Chapter Menu** matching
[297-26768](https://www.figma.com/design/e4DJxj1g7GTcfUpMaMOvVe/Hot-Cocoa?node-id=297-26768).

### PR 8.1 — Chapter Menu shell + states 1–2 ✅
- Match the **width and style of the Account Menu**.
- **State 1 (Not shared):** Share button + Delete Chapter; Share opens the Share modal.
- **State 2 (Shared):** a Shared row with up to **3 partner profile-picture thumbnails**, an Update button,
  and a Stop Sharing button.

### PR 8.2 — Chapter Menu update lifecycle: states 3–5 ✅
- **State 3 (Updating):** Update button with a small animated loading spinner.
- **State 4 (Updated):** success confirmation that returns to State 2 after **1600ms**.
- **State 5 (Error):** general error-message template.

### PR 8.3 — Style the "also stop sharing" checkbox (Delete Chapter) ✅
Style the sharing checkbox in the Delete Chapter modal (shipped in Stage 4-B, currently unstyled).

### PR 8.4 — Chapter Menu as a floating button 🎨
The Chapter Menu currently sits under a horizontal divider line in the panel. It should be a **floating
button that doesn't interfere with the rest of the panel**. Needs a design pass before build.

### PR 8.5 — Rectify the two `•••` menus 🤔
There are now two different `•••` menus. Decide how they consolidate (or how they visually differentiate)
before building. Needs a product decision. *(Depends on 8.1/8.4 landing first.)*

---

## Stage 9 — Shared page: item redesign + author filter

### PR 9.1 — Shared Chapter Item redesign ✅
Update the Shared Chapter Item (feed row, spec §3.2) to match
[297-26576](https://www.figma.com/design/e4DJxj1g7GTcfUpMaMOvVe/Hot-Cocoa?node-id=297-26576).

### PR 9.2 — Author Filter row (new feature) ✅
Add an Author Filter row to the `/shared` feed — filter the flat list by the author who shared. New feature;
scope the filter UI + client-side (or query) filtering over the existing feed data.

---

## Stage 10 — Read view: interactions & performance

Read-mode UX parity with the Write editor, plus perf. Independent PRs.

### PR 10.1 — Background-fetch sibling chapters in the same book ✅
Prefetch the reader's other accessible chapters of the current book (Book-Panel list) so navigation between
them is instant.

### PR 10.2 — Arrow-key chapter navigation; remove the arrow UI ✅
Remove the on-screen chapter arrow navigation. Replace with **left/right arrow-key** navigation — keyboard
only, no UI. *(Spec §3.3 currently describes on-screen arrows; update it.)*

### PR 10.3 — Resizable panels (match Write) ✅
Add read-view panel resizing, using the same mechanism as the Write editor.

### PR 10.4 — Page scrolls far past chapter content ✅
Bug: the read page can scroll much longer than the chapter content. Fix the container/overflow so the scroll
extent matches content height.

### PR 10.5 — Chapter grid view matches Write styling ✅
The read-view chapter grid view doesn't match the Write editor's grid styling. Align it. *(Note the read view
uses its own list/grid localStorage key per spec §3.3 — keep that.)*

---

## Stage 11 — Deferred spec features

Carried over from [SHARED_WITH_YOU.md](SHARED_WITH_YOU.md) Stage 4 fast-follow.

### PR 11.1 — Comment notification emails ✅
Per-comment email notifications (spec §5 notes comment activity stays in-app in v1). Design the notification
(digest vs. per-comment), reuse the `lib/email/` module and `resend` client, and gate on a per-user
preference like `notify_on_share`. **Confirm the trigger model with Scott before building** (avoid a noisy
per-comment blast).

### PR 11.2 — Recent share partners in the Share modal ✅
The "recent share partners" quick-list (tappable chips) above the Share-modal email input (spec §3.5 — a
natural spot was already left for it). Source recent recipients from `chapter_shares`.

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
