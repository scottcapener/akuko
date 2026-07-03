-- ============================================================
-- 006: Cap backup object size
-- The book-backups bucket was created (005) without a file_size_limit,
-- so it silently inherited the project-wide global limit (50 MB on the
-- Free plan). Declare it explicitly here so the ceiling is visible in
-- the schema and matches MAX_BACKUP_BYTES in lib/backup/generate.ts,
-- which preflights against it to give users a clear error.
--
-- 52428800 = 50 * 1024 * 1024 bytes.
-- ============================================================

update storage.buckets
set file_size_limit = 52428800
where id = 'book-backups';
