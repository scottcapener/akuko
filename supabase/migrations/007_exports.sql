-- ============================================================
-- 006: Manuscript exports
-- A user can export a book (or a subset of its chapters) to a
-- .docx manuscript, meant for uploading elsewhere (e.g. KDP) or
-- sending sample chapters to an editor. Each export is a single
-- .docx stored in the private `book-exports` bucket; this table
-- is the index. Only the most recent MAX_EXPORTS_PER_USER are
-- kept (see lib/export/generate.ts).
--
-- Like `backups`, an export can OUTLIVE the book it came from, so
-- book_id is nullable with ON DELETE SET NULL and book_title is
-- snapshotted at creation time so the list stays readable.
-- ============================================================

create table if not exists exports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  book_id       uuid references books(id) on delete set null,
  book_title    text not null default 'Untitled',
  storage_path  text not null,
  size_bytes    bigint not null default 0,
  -- 'full' exports the whole book; 'partial' exports a chosen subset of
  -- chapters (a "partial" manuscript / sample chapters for an editor).
  kind          text not null default 'full' check (kind in ('full', 'partial')),
  chapter_count integer not null default 0,
  created_at    timestamptz default now()
);

create index if not exists exports_user_created_idx
  on exports (user_id, created_at desc);

alter table exports enable row level security;

-- RLS scoped directly to user_id (not chained through book_id, which
-- can be null once the source book is deleted).
create policy "own exports" on exports
  for all using (auth.uid() = user_id);

-- ── Storage bucket ────────────────────────────────────────────
-- Private bucket for the .docx files. Same ownership-scoped RLS
-- pattern as `library-files` / `book-backups`: the first path
-- segment is the user id.
-- Path convention: {user_id}/{book_id-or-"deleted"}/{timestamp}.docx
--
insert into storage.buckets (id, name, public)
values ('book-exports', 'book-exports', false)
on conflict (id) do nothing;

create policy "owner can manage export files"
  on storage.objects for all
  using (
    bucket_id = 'book-exports'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
