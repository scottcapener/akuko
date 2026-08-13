-- ============================================================
-- 015: Notification preferences
-- Stage 3 of Shared With You (SHARED_WITH_YOU.md §6): a per-account
-- toggle for the "someone shared a chapter with you" email. Default
-- true — existing users stay opted in; the share email carries an
-- unsubscribe link that flips this to false.
--
-- No RLS change: the "own profile" policy (001) already lets a user
-- read and write this on their own row. The share flow reads it for
-- OTHER users through the service-role client (never the author's
-- session), so a recipient's preference is never exposed to the
-- author — hence no widened read policy here.
-- ============================================================

alter table profiles
  add column if not exists notify_on_share boolean not null default true;
