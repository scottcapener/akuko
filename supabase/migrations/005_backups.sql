-- ============================================================
-- 005: Backups & restore
-- Manual and automatic point-in-time backups of a book. Each
-- backup is a ZIP (manifest.json + bundled library images) stored
-- in the private `book-backups` bucket; this table is the index.
--
-- A backup must OUTLIVE the book it came from — restoring a deleted
-- book is the primary disaster-recovery case — so book_id is
-- nullable with ON DELETE SET NULL, and book_title is snapshotted
-- at creation time (not joined live) so the list stays readable
-- after the source book is gone.
-- ============================================================

create table if not exists backups (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade not null,
  book_id      uuid references books(id) on delete set null,
  book_title   text not null default 'Untitled',
  storage_path text not null,
  size_bytes   bigint not null default 0,
  trigger      text not null default 'manual' check (trigger in ('manual', 'auto')),
  status       text not null default 'complete' check (status in ('complete', 'failed')),
  created_at   timestamptz default now()
);

create index if not exists backups_user_created_idx
  on backups (user_id, created_at desc);

alter table backups enable row level security;

-- RLS scoped directly to user_id (not chained through book_id, which
-- can be null once the source book is deleted).
create policy "own backups" on backups
  for all using (auth.uid() = user_id);

-- ── Automatic-backup cadence (per book) ───────────────────────
alter table books add column if not exists auto_backup_cadence text
  not null default 'off' check (auto_backup_cadence in ('off', 'daily', 'weekly'));
alter table books add column if not exists last_auto_backup_at timestamptz;

-- ── Storage bucket ────────────────────────────────────────────
-- Private bucket for the backup ZIPs. Same ownership-scoped RLS
-- pattern as `library-files`: the first path segment is the user id.
-- Path convention: {user_id}/{book_id-or-"deleted"}/{timestamp}.zip
--
insert into storage.buckets (id, name, public)
values ('book-backups', 'book-backups', false)
on conflict (id) do nothing;

create policy "owner can manage backup files"
  on storage.objects for all
  using (
    bucket_id = 'book-backups'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ── Automatic-backup cadence sweep ────────────────────────────
-- A scheduled job must tick at least hourly and, for each book with
-- auto_backup_cadence != 'off' whose last_auto_backup_at is older
-- than its cadence interval, run the generation flow (trigger:auto)
-- and update last_auto_backup_at. This repo drives that from the
-- Next.js route /api/cron/backup-sweep (guarded by CRON_SECRET).
--
-- Wire it with Supabase Cron (pg_cron + pg_net), e.g.:
--
--   select cron.schedule(
--     'book-backup-sweep',
--     '0 * * * *',                       -- hourly
--     $$
--       select net.http_post(
--         url     := 'https://<your-app-host>/api/cron/backup-sweep',
--         headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
--       );
--     $$
--   );
