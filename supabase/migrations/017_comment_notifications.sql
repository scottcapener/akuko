-- ============================================================
-- 017: Comment notification emails
-- Stage 11 of Shared With You (SHARED_WITH_YOU.md §5): email a chapter's
-- author when someone comments on it. "Leading-edge" debounce — the email
-- fires on the FIRST comment of a commenter's session and links straight to
-- the chapter; further comments inside a cooldown window stay silent (the
-- link already shows them all).
--
-- Two parts:
--   1. notify_on_comment — the per-account toggle, mirroring notify_on_share
--      (015). Default true; the comment email carries an unsubscribe link that
--      flips it to false.
--   2. comment_notifications — the cooldown ledger. One row per
--      (chapter, commenter) records when that pair last triggered an email;
--      the send path upserts it and skips if it's within the window.
-- ============================================================

alter table profiles
  add column if not exists notify_on_comment boolean not null default true;

-- Cooldown ledger. Keyed on (shared_chapter_id, commenter_id): the author being
-- notified is implied (one owner per chapter), so it needn't be stored.
create table if not exists comment_notifications (
  shared_chapter_id uuid references shared_chapters(id) on delete cascade not null,
  commenter_id      uuid references profiles(id) on delete cascade not null,
  last_notified_at  timestamptz not null default now(),
  primary key (shared_chapter_id, commenter_id)
);

-- RLS on, no policies: this table is read and written ONLY by the service-role
-- client (which bypasses RLS) from the comment-notify path. No user session ever
-- touches it — the commenter must not be able to read the author's notify state,
-- and the author never needs to see the ledger. Same privacy reasoning as 015.
alter table comment_notifications enable row level security;
