-- ============================================================
-- 013: Share redemption + recipient resolution
--
-- Two SECURITY DEFINER helpers that bridge chapter_shares (keyed by email)
-- to accounts (keyed by id). No tokens — access is granted by email match
-- (SHARED_WITH_YOU.md §4).
--
--   resolve_share_recipients(shared_chapter_id) — called from the server-side
--     share route via the SERVICE-ROLE client right after grants are inserted.
--     Fills recipient_id on any pending grant whose email already belongs to
--     an account, so existing users get access immediately. Reads auth.users,
--     so it's locked to service_role — a normal client can't use it to probe
--     which emails have accounts.
--
--   redeem_my_shares() — called after signup/login. Fills recipient_id on the
--     CALLER's own pending grants (email match against their JWT). Safe for
--     authenticated to call: it only ever writes the caller's own id, keyed on
--     the caller's own verified email.
-- ============================================================

-- Resolve pending grants on one shared chapter against existing accounts.
create or replace function resolve_share_recipients(target uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update chapter_shares cs
  set recipient_id = u.id,
      accepted_at  = coalesce(cs.accepted_at, now())
  from auth.users u
  where cs.shared_chapter_id = target
    and cs.recipient_id is null
    and cs.recipient_email = u.email::citext;
$$;

-- Reading auth.users is privileged: keep this off every client role. The
-- server share route calls it through the service-role key.
revoke execute on function resolve_share_recipients(uuid) from public;
revoke execute on function resolve_share_recipients(uuid) from anon;
revoke execute on function resolve_share_recipients(uuid) from authenticated;
grant execute on function resolve_share_recipients(uuid) to service_role;

-- Redeem the current user's pending grants by email match. Returns how many
-- were redeemed (0 when logged out or nothing pending).
create or replace function redeem_my_shares()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  redeemed  integer;
  my_id     uuid := auth.uid();
  my_email  text := auth.email();
begin
  if my_id is null or my_email is null or my_email = '' then
    return 0;
  end if;

  update chapter_shares
  set recipient_id = my_id,
      accepted_at  = coalesce(accepted_at, now())
  where recipient_id is null
    and recipient_email = my_email::citext;

  get diagnostics redeemed = row_count;
  return redeemed;
end;
$$;

grant execute on function redeem_my_shares() to authenticated;
