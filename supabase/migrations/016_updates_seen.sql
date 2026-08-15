-- ============================================================
-- 016: What's New — per-account "seen" cursor
-- Stores the id of the most recent update the user has dismissed
-- (see lib/updates.ts). The What's New modal on the writer shows
-- whenever the latest update's id differs from this value, so a
-- dismissal sticks across the user's devices — the same reason the
-- Shared "seen" state lives server-side rather than in localStorage.
--
-- Null (the default, and every existing row) means "seen nothing":
-- such a user is shown the current latest update once, then the
-- dismissal writes its id here.
--
-- No RLS change: the "own profile" policy (001) already lets a user
-- read and write this on their own row, and no one else ever needs it.
-- ============================================================

alter table profiles
  add column if not exists updates_seen_id text;
