-- ============================================================
-- 019: Chapter-level edit timestamp
-- A reusable "when was this chapter last edited?" signal. Backs the "View as
-- reader" freshness check (SHARED_WITH_YOU.md): when an author opens the read
-- view of a shared chapter, compare chapters.updated_at against the snapshot's
-- shared_chapters.updated_at — if the chapter is newer, offer to update the
-- shared copy before viewing.
--
-- chapters had only created_at. This adds updated_at, kept current by:
--   1. set_updated_at (from 001) on direct chapter updates (title/position).
--   2. A trigger on scenes that bumps the PARENT chapter on any scene
--      insert/update/delete — so adding, editing, deleting, or reordering a
--      scene all register as a chapter edit. (max(scenes.updated_at) alone
--      would miss deletes, since the deleted row's timestamp is gone.)
-- ============================================================

-- ── Column ────────────────────────────────────────────────────
alter table chapters add column if not exists updated_at timestamptz not null default now();

-- Backfill: the latest of the chapter's own creation and any scene edit, so
-- existing chapters don't all read as "edited now" (which would make every
-- already-shared chapter look stale on first load).
update chapters c
set updated_at = greatest(
  c.created_at,
  coalesce((select max(s.updated_at) from scenes s where s.chapter_id = c.id), c.created_at)
);

-- ── Trigger 1: direct chapter edits (reuses the 001 helper) ────
drop trigger if exists chapters_updated_at on chapters;
create trigger chapters_updated_at before update on chapters
  for each row execute procedure set_updated_at();

-- ── Trigger 2: scene edits bump the parent chapter ────────────
create or replace function bump_chapter_on_scene_change()
returns trigger language plpgsql as $$
declare
  target uuid := coalesce(new.chapter_id, old.chapter_id);
begin
  update chapters set updated_at = now() where id = target;
  -- A scene moved between chapters (chapter_id changed) touches both.
  if (tg_op = 'UPDATE' and new.chapter_id is distinct from old.chapter_id) then
    update chapters set updated_at = now() where id = old.chapter_id;
  end if;
  return null; -- AFTER trigger; return value ignored
end;
$$;

drop trigger if exists scenes_bump_chapter on scenes;
create trigger scenes_bump_chapter
  after insert or update or delete on scenes
  for each row execute procedure bump_chapter_on_scene_change();
