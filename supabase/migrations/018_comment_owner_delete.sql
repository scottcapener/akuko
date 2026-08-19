-- ============================================================
-- 018: Chapter owner can delete comments
--
-- Extends the comment permission model (SHARED_WITH_YOU.md §3.4). Until now a
-- comment could only be deleted by its author (the "comments: author deletes
-- own" RLS policy in 014). The chapter owner could resolve but not remove — so
-- an off-topic or unwanted comment on their own chapter had no exit but resolve.
--
-- Give the owner a delete path WITHOUT loosening the author-only RLS policy
-- (which still guards the direct DELETE): a SECURITY DEFINER function that
-- deletes the row only when the caller is the comment's author OR the chapter's
-- owner. Mirrors set_comment_resolved (014) — the function enforces the check
-- itself, so the base table's policies stay strict.
-- ============================================================

create or replace function delete_comment(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  chap   uuid;
  author uuid;
begin
  select shared_chapter_id, author_id into chap, author
  from comments where id = target;
  if chap is null then
    return; -- already gone (idempotent)
  end if;

  if author <> auth.uid()
     and not exists (
       select 1 from shared_chapters where id = chap and owner_id = auth.uid()
     ) then
    raise exception 'Not authorized to delete this comment';
  end if;

  delete from comments where id = target;
end;
$$;

grant execute on function delete_comment(uuid) to authenticated;
