-- ============================================================
-- 003: Active chapter
-- Remembers which chapter a writer was last in, so returning to
-- the Write page reopens their last edit instead of chapter one.
-- ============================================================

-- Nullable: if the referenced chapter is deleted, fall back to null
-- (the app resolves null to the first chapter).
alter table books add column if not exists active_chapter_id uuid references chapters(id) on delete set null;
