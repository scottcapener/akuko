# Roadmap: autosave tuning → conflict sunset → live collab

**Driving priority:** real users are hurting *now* from false conflict modals on
slow networks. This sequence front-loads that fix, treats live collaboration as
the net-new feature it is, and defers the one genuinely hard piece (editor
external-update re-sync, "Blocker 2") until it's actually needed.

Related specs: [CONFLICT_SUNSET.md](CONFLICT_SUNSET.md), [SHARED_LIVE.md](SHARED_LIVE.md),
[SHARED_WITH_YOU.md](SHARED_WITH_YOU.md).

## Dependency spine

```
Phase 0 (autosave)  ──independent──▶ ship anytime
Phase 1 (LWW push)  ──── the actual conflict fix; retires the modal
        │
        └─▶ Phase 2 (cross-device pull, focus-refresh)  ── completes A→B→A
                                                              │
Phase 3 (SHARED_LIVE 13.1 plumbing) ─┬─▶ 13.2 presence     │
                                     └─▶ 13.3 live comments │
                                                            │
        Phase 4 (optional): point 13.1's Realtime at `scenes` ◀┘
                            = upgrade Phase 2 pull from focus to live
```

**Recommended order:** Phase 0 → Phase 1 (fixes the live bug) → Phase 2 →
Phase 3, with Phase 4 as a later luxury. Phases 0–2 close the conflict story
end-to-end; Phase 3 is a clean feature start after.

---

## Phase 0 — Autosave cadence + indicator threshold

- `AUTOSAVE_DELAY` 2s → ~5s, `AUTOSAVE_MAX_WAIT` 10s → ~30s (`lib/useHotCocoaDb.ts`).
- Only surface "Saving…" if a save exceeds ~400–500ms, so the flicker goes away
  independent of cadence (`components/CenterColumn.tsx` + `components/BookInfoColumn.tsx`
  — two copies, keep in sync).
- **Value:** kills the flicker; cuts false-conflict *frequency* as a stopgap. No
  migration, low risk.
- **Not a fix** for the conflict class — that's Phase 1.

## Phase 1 — LWW push (CONFLICT_SUNSET Part 1) — the real fix

- Migration `021`: add `content_edited_at`, backfill from `updated_at`.
- Rewrite `saveScene` to the single `.lt("content_edited_at", authoredAt)` guarded
  write (`lib/db.ts`); result `"conflict"` → `"stale"`.
- Carry `authoredAt` through `pendingSaves` + the IndexedDB queue; delete
  `pendingBases`/`sceneVersions`, `SceneConflict`, `resolveConflict`, the modal,
  and `useEditorOwnership` + `EditorLockedOverlay`.
- **Value:** eliminates the false-positive class outright — including the lost-ack
  retry path (a replay carries the same `authoredAt`, fails the strict `<`, adopts
  silently). This is what gets the rural users unstuck.
- **Self-contained:** still push-only, same as today — but the stale-adopt branch
  refreshes a scene *on save attempt*, so it delivers partial pull for free. Safe
  to ship without Phase 2.

## Phase 2 — Cross-device pull, focus-refresh (CONFLICT_SUNSET Part 2)

- Force-refresh the active chapter on focus/visibility/online; **Blocker 2** —
  version-gated `innerHTML` re-sync in `SceneBlock`, guarded on not-focused/not-dirty.
- **Value:** completes the pure A→B→A switch-back (refresh when A *didn't* edit).
- **Risk:** Blocker 2 is the one genuinely hard, caret-eating-prone piece in either
  plan. Budget for it. No Realtime dependency — take the focus-refresh v1 rather
  than waiting on Phase 3.

## Phase 3 — SHARED_LIVE (net-new feature)

- **13.1 plumbing** — Realtime publication + `REPLICA IDENTITY FULL` +
  `realtime.messages` authz (its migration, renumbered — see flags);
  `lib/shared/liveChannel.ts` + `useSharedLive`. No UI.
- **13.2 presence** and **13.3 live comments** — independent of each other, both
  need 13.1.
- **13.4 polish** — overflow/idle/mobile/reconnect.

## Phase 4 — (optional) Upgrade scene pull to Realtime

- Once 13.1 exists, point its refetch-on-signal pattern at `scenes`/`book_id` to
  turn Phase 2's focus-refresh into live-while-visible sync. Pure enhancement.

---

## Cross-cutting flags (coordinate before building)

1. **Migration numbering.** Latest on disk is `020`. `021` is free and claimed by
   CONFLICT_SUNSET (Phase 1). SHARED_LIVE's "018" is **stale** (018 is already
   `018_comment_owner_delete.sql`) — renumber to the next free slot when it ships.
   Whichever effort ships first takes `021`; don't let both claim it.
2. **The save indicator is a three-way touchpoint.** Phase 0 changes its
   show-threshold; SHARED_LIVE 13.2 **relayouts** it to sit right of the presence
   stack (`components/CenterColumn.tsx`); CONFLICT_SUNSET may repurpose/delete
   `ConflictCopyToast`. Do Phase 0's change now; 13.2 moves it later.
3. **Blocker 2 is the shared risk** between Phase 2 and Phase 4 — the editor
   ignoring external body updates. Solve it once, in Phase 2.
4. **Open decision (CONFLICT_SUNSET §Existing-copy cleanup):** what to do with
   `(conflicting copy · date)` scenes already in users' books — leave / audit-script
   / bulk-delete. Blocks nothing, but Phase 1 stops *creating* them, so decide
   before users notice the old ones are orphaned.
