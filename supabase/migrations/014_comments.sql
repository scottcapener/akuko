-- ============================================================
-- 014: Comments — Shared With You, Stage 2
--
-- Anchored comments on a shared chapter's scenes (SHARED_WITH_YOU.md §3.4/§3.7).
-- One shared conversation per chapter, visible to the author AND every
-- recipient. Not threaded in v1.
--
-- Anchoring: a comment points at one shared_scene (immutable snapshot text) by
-- character offsets into shared_scenes.body_text, and — through
-- shared_scenes.scene_id — back at the live scene, which is what lets comments
-- surface in the author's editor (§3.7). snapshot_version records the share
-- generation (shared_chapters.updated_at) the offsets were captured against, so
-- Stage 4 can mark a comment stale after a re-share.
--
-- Permissions (§3.4): everyone with access reads; you edit/delete only your own
-- comment; only the CHAPTER OWNER resolves — and resolving is a separate,
-- column-limited path (set_comment_resolved) so the owner can mark done without
-- being able to edit others' words.
-- ============================================================

create table if not exists comments (
  id                uuid primary key default gen_random_uuid(),
  shared_chapter_id uuid references shared_chapters(id) on delete cascade not null,
  shared_scene_id   uuid references shared_scenes(id) on delete cascade not null,
  author_id         uuid references profiles(id) on delete cascade not null,
  body              text not null,                          -- plain text
  quote_text        text not null default '',
  quote_start       integer not null default 0,             -- offsets into shared_scenes.body_text
  quote_end         integer not null default 0,
  -- The shared_chapters.updated_at generation the quote was captured against.
  snapshot_version  timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  resolved_at       timestamptz,
  resolved_by       uuid references profiles(id) on delete set null
);

-- ── RLS ───────────────────────────────────────────────────────
alter table comments enable row level security;

-- Read: anyone with access to the chapter (owner or accepted recipient).
create policy "comments: read with access" on comments
  for select using (has_shared_access(shared_chapter_id));

-- Insert: must have access AND be inserting as yourself (no forged authorship).
create policy "comments: insert own with access" on comments
  for insert with check (
    has_shared_access(shared_chapter_id) and author_id = (select auth.uid())
  );

-- Edit / delete: only your own comment. Resolving is NOT done through this path
-- (it goes through set_comment_resolved), so the owner can't edit others' text.
create policy "comments: author edits own" on comments
  for update using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));
create policy "comments: author deletes own" on comments
  for delete using (author_id = (select auth.uid()));

-- Resolve / unresolve — CHAPTER OWNER only, and only the resolved_* columns.
-- SECURITY DEFINER so it isn't gated by the update policy above; it enforces
-- ownership itself and touches nothing but resolved_at/resolved_by.
create or replace function set_comment_resolved(target uuid, resolved boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  chap uuid;
begin
  select shared_chapter_id into chap from comments where id = target;
  if chap is null then
    return;
  end if;
  if not exists (
    select 1 from shared_chapters where id = chap and owner_id = auth.uid()
  ) then
    raise exception 'Not authorized to resolve this comment';
  end if;

  update comments
  set resolved_at = case when resolved then now() else null end,
      resolved_by = case when resolved then auth.uid() else null end,
      updated_at  = now()
  where id = target;
end;
$$;

grant execute on function set_comment_resolved(uuid, boolean) to authenticated;

-- ── Indexes — FK + the columns we filter/sort on ──────────────
create index if not exists comments_shared_chapter_id_idx on comments (shared_chapter_id);
create index if not exists comments_shared_scene_id_idx   on comments (shared_scene_id);
create index if not exists comments_author_id_idx         on comments (author_id);
create index if not exists comments_resolved_at_idx       on comments (resolved_at);
