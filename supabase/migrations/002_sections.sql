-- ============================================================
-- 002: Sections
-- Adds a sections table so chapters can be grouped into named
-- sections (e.g. "Chapters", "Research", "Archive").
-- ============================================================

create table if not exists sections (
  id       uuid primary key default gen_random_uuid(),
  book_id  uuid references books(id) on delete cascade not null,
  label    text not null default 'Chapters',
  position integer not null default 0,
  created_at timestamptz default now()
);

alter table sections enable row level security;

create policy "own sections" on sections
  for all using (
    book_id in (select id from books where user_id = auth.uid())
  );

-- Add section_id to chapters (nullable first for migration)
alter table chapters add column if not exists section_id uuid references sections(id) on delete cascade;

-- Create a default section for each book that already has chapters
insert into sections (book_id, label, position)
select distinct book_id, 'Chapters', 0
from chapters
where section_id is null
on conflict do nothing;

-- Assign existing orphan chapters to their book's newly-created section
update chapters c
set section_id = s.id
from sections s
where s.book_id = c.book_id
  and c.section_id is null;

-- Now enforce not null
alter table chapters alter column section_id set not null;
