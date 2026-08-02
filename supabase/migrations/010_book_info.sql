-- ============================================================
-- 010: Book Info
--
-- Adds the Book Info surface — top-level information about a book:
-- tags, a synopsis, its own library, and writing stats.
--
-- 1. books.info_chapter_id — points at a hidden "info chapter" that
--    reuses the existing chapter/scene/library machinery to store the
--    Synopsis (its single scene) and the Book-Info Library (its
--    library_items). The chapter lives in a hidden section that the app
--    never surfaces in the Book Panel, so it stays out of word counts,
--    side-by-side, exports, and backups.
-- 2. books.tags — selected book tags (array of tag ids).
-- 3. books.wordcount_excluded_sections — sections the author has
--    unchecked from the "official" manuscript word count.
-- 4. writing_days — one row per calendar day the author wrote in a book;
--    drives Book Stats (a session = a writing day; total writing time =
--    sum of active_seconds).
-- ============================================================

alter table books add column if not exists info_chapter_id uuid
  references chapters(id) on delete set null;
alter table books add column if not exists tags jsonb default '[]';
alter table books add column if not exists wordcount_excluded_sections jsonb default '[]';

-- ── Writing stats (daily rollup) ──────────────────────────────
create table if not exists writing_days (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users(id) on delete cascade not null,
  book_id        uuid references books(id) on delete cascade not null,
  day            date not null,
  active_seconds integer not null default 0,
  created_at     timestamptz default now(),
  unique (book_id, day)
);

alter table writing_days enable row level security;

create policy "own writing_days" on writing_days
  for all using ((select auth.uid()) = user_id);

create index if not exists writing_days_book_idx on writing_days (book_id);
