-- ============================================================
-- 004: Multiple books
-- A user can now own several books. The "active" book (the one
-- the Write page opens) is simply the most-recently-opened one,
-- tracked via last_opened_at. This lays the groundwork for the
-- upcoming backup/restore feature.
-- ============================================================

alter table books add column if not exists last_opened_at timestamptz;

-- Backfill existing rows so ordering is stable (older books sort last).
update books
set last_opened_at = coalesce(updated_at, created_at, now())
where last_opened_at is null;

alter table books alter column last_opened_at set default now();

create index if not exists books_user_last_opened_idx
  on books (user_id, last_opened_at desc);
