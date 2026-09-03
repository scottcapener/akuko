-- ============================================================
-- 020: Scene updated_at bumps on CONTENT change only
--
-- `scenes.updated_at` is the optimistic-concurrency token: every content save
-- conditions on `.eq("updated_at", base)` (lib/db.ts saveScene), and the client
-- caches the last-written value as the base for the next edit.
--
-- Problem: the 001 `scenes_updated_at` trigger bumped updated_at on ANY row
-- update, including position-only reorders and chapter_id-only moves
-- (reorderScenes / moveScene / splitChapter, which PATCH `position` /
-- `chapter_id` with no `.select()`). Those writes advanced the server token
-- WITHOUT the client learning the new value, so the next content edit to a
-- reordered scene conditioned on a stale base → zero rows matched → a FALSE
-- "conflict" modal, even on a single device with a good connection.
--
-- Fix: only bump updated_at when a content column (label or body) actually
-- changes. Structural reorders/moves no longer invalidate the concurrency base,
-- so a drag-then-edit can't self-conflict. Content edits still bump it, so
-- genuine cross-device conflicts are still detected.
--
-- The 019 `scenes_bump_chapter` AFTER trigger is intentionally left unchanged:
-- chapters.updated_at should still move on a reorder (scene order is part of a
-- chapter's freshness for the shared-chapter "View as reader" check).
-- ============================================================

drop trigger if exists scenes_updated_at on scenes;

create trigger scenes_updated_at before update on scenes
  for each row
  when (
    old.label is distinct from new.label
    or old.body is distinct from new.body
  )
  execute procedure set_updated_at();
