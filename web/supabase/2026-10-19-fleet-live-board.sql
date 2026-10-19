-- Fleet: live board. Apply by hand in the SQL editor. Safe to re-run.
--
-- ORDER: apply this file before (or with) the deploy of the code that joins
-- `fleet:board` (lib/fleet-live.ts). Without it the private join is refused;
-- the board still works, it just is not live until this is applied.
--
-- After any write to the fleet tables — from /api/fleet, the cron or an admin
-- route — a statement trigger broadcasts an EMPTY `changed` event on the
-- private Realtime topic `fleet:board`. Every open Fleet screen then refetches
-- its board through GET /api/fleet, which decides what each viewer may see
-- (their own requests, admins all). The ping carries no rows on purpose: the
-- requests table is service-role only, and a payload would bypass that.
--
-- Statement-level, so a write that touches fifty rows sends one ping, and the
-- client debounces the few a single action sends across tables. A failure to
-- broadcast never fails the write: a missed ping only means a stale screen
-- until the next one, a failed booking means a lost booking.

begin;

create or replace function public.fleet_broadcast_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform realtime.send('{}'::jsonb, 'changed', 'fleet:board', true);
  exception when others then
    raise warning 'fleet_broadcast_changed: %', sqlerrm;
  end;
  return null;
end;
$$;

-- A trigger function cannot be called directly, but nobody needs EXECUTE on it
-- either (2026-09-29-rpc-revoke-anon-execute.sql: grant only what is needed).
revoke execute on function public.fleet_broadcast_changed() from public, anon, authenticated;

drop trigger if exists fleet_assets_broadcast on public.fleet_assets;
create trigger fleet_assets_broadcast
  after insert or update or delete on public.fleet_assets
  for each statement execute function public.fleet_broadcast_changed();

drop trigger if exists fleet_reservations_broadcast on public.fleet_reservations;
create trigger fleet_reservations_broadcast
  after insert or update or delete on public.fleet_reservations
  for each statement execute function public.fleet_broadcast_changed();

drop trigger if exists fleet_booking_requests_broadcast on public.fleet_booking_requests;
create trigger fleet_booking_requests_broadcast
  after insert or update or delete on public.fleet_booking_requests
  for each statement execute function public.fleet_broadcast_changed();

drop trigger if exists fleet_holder_aliases_broadcast on public.fleet_holder_aliases;
create trigger fleet_holder_aliases_broadcast
  after insert or update or delete on public.fleet_holder_aliases
  for each statement execute function public.fleet_broadcast_changed();

-- Who may listen: role holders, the same rule as the fleet tables
-- (public.has_app_role(), 2026-10-02-require-role.sql). No insert policy, so
-- no client can send a ping of its own — only the trigger above, which runs
-- as the function owner.
drop policy if exists fleet_board_realtime_select on realtime.messages;
create policy fleet_board_realtime_select
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() = 'fleet:board'
    and realtime.messages.extension = 'broadcast'
    and public.has_app_role()
  );

commit;

-- Verify:
--   select tgname from pg_trigger where tgname like 'fleet_%_broadcast';  -- 4 rows
--   select policyname from pg_policies where schemaname = 'realtime' and tablename = 'messages';
--   -- then book something in one browser and watch the Fleet calendar change in another.
