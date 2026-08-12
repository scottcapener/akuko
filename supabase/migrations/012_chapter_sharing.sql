-- ============================================================
-- 012: Chapter sharing — "Shared With You" (Stage 1 foundation)
--
-- Private, per-chapter sharing modelled on Google Drive/Docs
-- (see SHARED_WITH_YOU.md). Sharing SNAPSHOTS a chapter: the
-- author's live rows are copied, sanitized, into shared_scenes and
-- recipients read the copy — they get zero access to books /
-- chapters / scenes. This keeps the only cross-user read path on
-- two tables that have no relationship to the live editor, and
-- means (Stage 2) comment anchors index into immutable text.
--
-- This migration lays the four Stage-1 tables + RLS. The `comments`
-- table lands with Stage 2.
--
--   shared_chapters      — the snapshot; one per live chapter.
--                          Carries a COPY of book identity (title,
--                          cover, position) so recipients render
--                          the chapter without touching live data.
--   shared_scenes        — the snapshot's scenes: sanitized
--                          body_html + a plain-text projection
--                          (body_text) that Stage-2 comment offsets
--                          index into. scene_id points back at the
--                          live scene (identity, not text) so
--                          comments can later surface in the editor.
--   chapter_shares       — the access grant, one per person, keyed
--                          by email. recipient_id null = PENDING
--                          (no account yet); redeemed by email match
--                          at signup/login (Stage 2).
--   shared_chapter_reads — per-user last_seen_at. No row = unread
--                          shared chapter (drives the feed's unread
--                          dot); (Stage 3) also unread-comment state.
--
-- Snapshots outlive their live source on purpose (§7): deleting the
-- live chapter/book nulls the back-reference but keeps what
-- recipients already read — hence `on delete set null`, not cascade,
-- on chapter_id / book_id / scene_id.
-- ============================================================

-- Case-insensitive email matching for grants + redemption.
create extension if not exists citext;

-- ── shared_chapters: the snapshot (one per live chapter) ──────
create table if not exists shared_chapters (
  id              uuid primary key default gen_random_uuid(),
  -- Back-reference to the live chapter; nulled (not cascaded) on delete
  -- so the snapshot survives. UNIQUE(chapter_id) enforces one snapshot
  -- per live chapter — many NULLs are allowed, so deleted-chapter
  -- snapshots coexist.
  chapter_id      uuid references chapters(id) on delete set null,
  owner_id        uuid references auth.users(id) on delete cascade not null,
  -- Groups a book's snapshots in the read view's Book Panel; nulled (not
  -- cascaded) on book delete so the snapshot survives that too.
  book_id         uuid references books(id) on delete set null,
  -- SNAPSHOT of book identity — rendered on the feed row + Book Panel
  -- without the recipient ever reading the author's live book row.
  book_title      text not null default '',
  cover_path      text,                -- storage path; served via signed URL
  chapter_title   text not null default '',
  book_position   integer not null default 0,  -- order within the book
  first_shared_at timestamptz not null default now(),
  updated_at      timestamptz not null default now(),  -- bumps on re-share (generation)
  unshared_at     timestamptz,
  unique (chapter_id)
);

-- ── shared_scenes: the snapshot's scenes ──────────────────────
create table if not exists shared_scenes (
  id                uuid primary key default gen_random_uuid(),
  shared_chapter_id uuid references shared_chapters(id) on delete cascade not null,
  -- Identity link back to the live scene (kept even after the text drifts);
  -- nulled on live-scene delete so the snapshot text survives.
  scene_id          uuid references scenes(id) on delete set null,
  position          integer not null default 0,
  body_html         text not null default '',  -- SANITIZED at share time (lib/sanitize.ts)
  body_text         text not null default ''   -- plain-text projection; Stage-2 anchors index here
);

-- ── chapter_shares: the per-person access grant ───────────────
create table if not exists chapter_shares (
  id                uuid primary key default gen_random_uuid(),
  shared_chapter_id uuid references shared_chapters(id) on delete cascade not null,
  recipient_email   citext not null,                 -- always set: the address shared to
  recipient_id      uuid references profiles(id) on delete cascade,  -- null = PENDING
  shared_by         uuid references auth.users(id) on delete cascade not null,  -- == owner in v1
  created_at        timestamptz not null default now(),
  accepted_at       timestamptz,
  revoked_at        timestamptz,
  unique (shared_chapter_id, recipient_email)
);

-- ── shared_chapter_reads: per-user read cursor ────────────────
create table if not exists shared_chapter_reads (
  shared_chapter_id uuid references shared_chapters(id) on delete cascade not null,
  user_id           uuid references auth.users(id) on delete cascade not null,
  last_seen_at      timestamptz not null default now(),
  primary key (shared_chapter_id, user_id)
);

-- ── Access predicate ──────────────────────────────────────────
-- The one rule reused across every policy: you may see a shared
-- chapter if you own it OR you are an accepted, un-revoked recipient.
-- SECURITY DEFINER so it bypasses RLS on the tables it reads — that's
-- what lets it be called from the chapter_shares policies without
-- recursing. STABLE + set search_path per Supabase guidance.
create or replace function has_shared_access(target uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    exists (
      select 1 from shared_chapters sc
      where sc.id = target and sc.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from chapter_shares cs
      where cs.shared_chapter_id = target
        and cs.recipient_id = (select auth.uid())
        and cs.revoked_at is null
    );
$$;

-- Do you and `other` share any chapter (in either direction)? Backs the
-- widened profiles read policy. SECURITY DEFINER for the same reason.
create or replace function shares_chapter_with(other uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from shared_chapters sc
    join chapter_shares cs on cs.shared_chapter_id = sc.id
    where cs.revoked_at is null
      and cs.recipient_id is not null
      and (
        (sc.owner_id = (select auth.uid()) and cs.recipient_id = other)
        or (cs.recipient_id = (select auth.uid()) and sc.owner_id = other)
      )
  );
$$;

-- ── Row Level Security ────────────────────────────────────────
alter table shared_chapters      enable row level security;
alter table shared_scenes        enable row level security;
alter table chapter_shares       enable row level security;
alter table shared_chapter_reads enable row level security;

-- shared_chapters: read if you have access; write only as owner.
create policy "shared_chapters: read with access" on shared_chapters
  for select using (has_shared_access(id));
create policy "shared_chapters: owner writes" on shared_chapters
  for all using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- shared_scenes: read if you have access to the parent; write only as owner.
create policy "shared_scenes: read with access" on shared_scenes
  for select using (has_shared_access(shared_chapter_id));
create policy "shared_scenes: owner writes" on shared_scenes
  for all using (
    shared_chapter_id in (
      select id from shared_chapters where owner_id = (select auth.uid())
    )
  )
  with check (
    shared_chapter_id in (
      select id from shared_chapters where owner_id = (select auth.uid())
    )
  );

-- chapter_shares: the owner manages grants; a recipient may read the grants
-- on chapters they can access, and revoke their OWN grant (§7).
create policy "chapter_shares: owner manages" on chapter_shares
  for all using (
    shared_chapter_id in (
      select id from shared_chapters where owner_id = (select auth.uid())
    )
  )
  with check (
    shared_chapter_id in (
      select id from shared_chapters where owner_id = (select auth.uid())
    )
  );
create policy "chapter_shares: recipient reads" on chapter_shares
  for select using (has_shared_access(shared_chapter_id));
create policy "chapter_shares: recipient revokes own" on chapter_shares
  for update using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

-- shared_chapter_reads: each user manages only their own cursor, and only
-- for chapters they can actually access.
create policy "own shared_chapter_reads" on shared_chapter_reads
  for all using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid()) and has_shared_access(shared_chapter_id)
  );

-- ── Widen the profiles read policy ────────────────────────────
-- Was "own profile" only (009). Recipient rows + comment attribution would
-- render blank otherwise. Add: you may READ the profile of anyone you share
-- a chapter with, in either direction. The existing "own profile" (FOR ALL)
-- policy stays; this only broadens SELECT.
create policy "profiles: read share partners" on profiles
  for select using (shares_chapter_with(id));

-- ── Indexes — every FK (this is read-heavy) ───────────────────
create index if not exists shared_chapters_chapter_id_idx      on shared_chapters (chapter_id);
create index if not exists shared_chapters_owner_id_idx        on shared_chapters (owner_id);
create index if not exists shared_chapters_book_id_idx         on shared_chapters (book_id);
create index if not exists shared_scenes_shared_chapter_id_idx on shared_scenes (shared_chapter_id);
create index if not exists shared_scenes_scene_id_idx          on shared_scenes (scene_id);
create index if not exists chapter_shares_shared_chapter_id_idx on chapter_shares (shared_chapter_id);
create index if not exists chapter_shares_recipient_id_idx      on chapter_shares (recipient_id);
-- Redemption (Stage 2) looks up pending grants by email.
create index if not exists chapter_shares_recipient_email_idx   on chapter_shares (recipient_email);
create index if not exists shared_chapter_reads_user_id_idx     on shared_chapter_reads (user_id);
