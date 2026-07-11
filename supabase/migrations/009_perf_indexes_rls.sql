-- ============================================================
-- 009: Performance — FK indexes + RLS uid caching
--
-- Two cheap, behaviour-preserving performance fixes ahead of the
-- read-heavier roadmap (public books, sharing):
--
-- 1. Index every foreign-key column the app filters, joins, RLS-checks,
--    or cascade-deletes on. Only books(user_id, last_opened_at),
--    backups, and exports were indexed; the rest forced sequential
--    scans on every chapter/scene/library read and on cascade deletes.
--
-- 2. Rewrite the RLS policies to call (select auth.uid()) instead of a
--    bare auth.uid(). Postgres treats the subselect as a one-time
--    InitPlan and evaluates it once per query rather than once per row —
--    the policies are otherwise identical, so this is pure speedup.
--    (See Supabase's "RLS performance" guidance.)
-- ============================================================

-- ── Foreign-key indexes ───────────────────────────────────────
create index if not exists sections_book_id_idx        on sections (book_id);
create index if not exists chapters_book_id_idx         on chapters (book_id);
create index if not exists chapters_section_id_idx      on chapters (section_id);
create index if not exists scenes_chapter_id_idx        on scenes (chapter_id);
create index if not exists library_items_chapter_id_idx on library_items (chapter_id);
-- books.active_chapter_id is an FK (ON DELETE SET NULL) scanned on every
-- chapter delete; backups/exports.book_id back their ON DELETE SET NULL and
-- the per-book backup-retention sweep (which filters on book_id).
create index if not exists books_active_chapter_id_idx  on books (active_chapter_id);
create index if not exists backups_book_id_idx          on backups (book_id);
create index if not exists exports_book_id_idx          on exports (book_id);

-- ── RLS policies: cache auth.uid() per query ──────────────────
-- Each policy is recreated with identical semantics, only wrapping
-- auth.uid() in a scalar subselect so it's evaluated once per query.

drop policy if exists "own profile" on profiles;
create policy "own profile" on profiles
  for all using ((select auth.uid()) = id);

drop policy if exists "own books" on books;
create policy "own books" on books
  for all using ((select auth.uid()) = user_id);

drop policy if exists "own sections" on sections;
create policy "own sections" on sections
  for all using (
    book_id in (select id from books where user_id = (select auth.uid()))
  );

drop policy if exists "own chapters" on chapters;
create policy "own chapters" on chapters
  for all using (
    book_id in (select id from books where user_id = (select auth.uid()))
  );

drop policy if exists "own scenes" on scenes;
create policy "own scenes" on scenes
  for all using (
    chapter_id in (
      select id from chapters where book_id in (
        select id from books where user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "own library items" on library_items;
create policy "own library items" on library_items
  for all using (
    chapter_id in (
      select id from chapters where book_id in (
        select id from books where user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "own backups" on backups;
create policy "own backups" on backups
  for all using ((select auth.uid()) = user_id);

drop policy if exists "own exports" on exports;
create policy "own exports" on exports
  for all using ((select auth.uid()) = user_id);
