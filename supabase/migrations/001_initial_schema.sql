-- ============================================================
-- Akuko initial schema
-- Run this in the Supabase SQL editor or via supabase db push
-- ============================================================

-- Users are managed by Supabase Auth (auth.users).
-- Profiles extend with display_name and pen_name.

create table if not exists profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  display_name text,
  pen_name text,
  created_at timestamptz default now()
);

create table if not exists books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null default 'Untitled',
  cover_color text default '#2a2a2e',
  cover_image_path text,          -- Supabase Storage path for cover image
  word_count integer default 0,
  unlocks jsonb default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists chapters (
  id uuid primary key default gen_random_uuid(),
  book_id uuid references books(id) on delete cascade not null,
  title text not null default 'Chapter 1',
  position integer not null default 0,
  created_at timestamptz default now()
);

create table if not exists scenes (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid references chapters(id) on delete cascade not null,
  label text default '',
  body text default '',
  position integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists library_items (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid references chapters(id) on delete cascade not null,
  type text not null check (type in ('image', 'text', 'music')),
  -- For images and text files: Supabase Storage path
  storage_path text,
  -- For music links: original URL + OG metadata
  url text,
  og_title text,
  og_description text,
  og_image text,
  -- For text/images: original filename
  filename text,
  position integer not null default 0,
  created_at timestamptz default now()
);

-- ── Row Level Security ────────────────────────────────────────

alter table profiles enable row level security;
alter table books enable row level security;
alter table chapters enable row level security;
alter table scenes enable row level security;
alter table library_items enable row level security;

create policy "own profile" on profiles
  for all using (auth.uid() = id);

create policy "own books" on books
  for all using (auth.uid() = user_id);

create policy "own chapters" on chapters
  for all using (
    book_id in (select id from books where user_id = auth.uid())
  );

create policy "own scenes" on scenes
  for all using (
    chapter_id in (
      select id from chapters where book_id in (
        select id from books where user_id = auth.uid()
      )
    )
  );

create policy "own library items" on library_items
  for all using (
    chapter_id in (
      select id from chapters where book_id in (
        select id from books where user_id = auth.uid()
      )
    )
  );

-- ── Storage bucket ────────────────────────────────────────────
-- Run this separately if using Supabase CLI; or create the bucket
-- manually in the Supabase dashboard under Storage.
--
-- insert into storage.buckets (id, name, public)
-- values ('library-files', 'library-files', false);
--
-- create policy "owner can manage library files"
--   on storage.objects for all
--   using (bucket_id = 'library-files' and auth.uid()::text = (storage.foldername(name))[1]);

-- ── Helper: updated_at trigger ────────────────────────────────

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger books_updated_at before update on books
  for each row execute procedure set_updated_at();

create trigger scenes_updated_at before update on scenes
  for each row execute procedure set_updated_at();
