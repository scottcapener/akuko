-- ============================================================
-- 021: Scene content_edited_at — last-write-wins concurrency token
--
-- Replaces the `.eq("updated_at", base)` optimistic-concurrency check (migrations
-- 019/020) that kept firing FALSE conflict modals. That check depends on a cached
-- client-side "base" version which drifts stale — from a lost network ack that
-- retries against an already-committed write, a structural reorder, or keystrokes
-- coalesced across a save boundary — and a stale base means zero rows matched,
-- i.e. a spurious conflict. See CONFLICT_SUNSET.md.
--
-- `content_edited_at` is a CLIENT-supplied timestamp: when the author last actually
-- edited the scene's text. The save becomes a self-contained last-write-wins write
-- (lib/db.ts saveScene) —
--     update scenes set ... , content_edited_at = :authoredAt
--      where id = :id and (content_edited_at is null or content_edited_at < :authoredAt)
-- so the newest edit wins on whichever device made it, with no cached base to go
-- stale and therefore no false-positive class. A save that lost its ack and retries
-- carries the same authoredAt, fails the strict `<`, and is silently reconciled.
--
-- `updated_at` is intentionally left untouched: the 019 `scenes_bump_chapter` AFTER
-- trigger and the shared-chapter "View as reader" freshness check still rely on it,
-- and the 020 content-only `set_updated_at` trigger stays. content_edited_at is an
-- independent token written explicitly by the client, never by a trigger.
-- ============================================================

alter table scenes add column content_edited_at timestamptz;

-- Backfill so existing rows have a sane starting token (idempotent).
update scenes set content_edited_at = updated_at where content_edited_at is null;

-- New rows default to now(); the client overwrites it on every content save.
alter table scenes alter column content_edited_at set default now();
