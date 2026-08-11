-- ============================================================
-- 011: Account profile — avatar + author bio
-- The Account page grows from a bare auth readout into a real
-- profile: a display name, a pen name, an uploaded profile
-- picture, and an "Author Bio" (a Synopsis-style rich block).
--
-- `display_name` / `pen_name` already exist (001). This adds:
--   • avatar_path — a storage path in the existing `library-files`
--     bucket, under {user_id}/avatar/…, so that bucket's
--     owner-scoped RLS already covers it (no new bucket). Served
--     via a signed URL, exactly like book covers.
--   • bio — sanitized HTML for the Author Bio block. Stored
--     already-clean (server sanitizes on save; see lib/sanitize.ts)
--     against the day it renders in someone else's browser
--     (Shared With You).
--
-- No RLS change: the existing "own profile" policy (001) already
-- lets a user read and write these on their own row. Widening
-- profile reads to people you share with belongs to the Shared
-- With You migration, not here.
-- ============================================================

alter table profiles add column if not exists avatar_path text;
alter table profiles add column if not exists bio text;
