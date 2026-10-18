-- Fleet edge cases, phase 1: make the data honest.
-- Plan: web/docs/fleet-edge-cases.md (P1).
--
-- Two additions, both structure only:
--
--   1. fleet_reservations.closed_reason — WHY a booking closed. The status says
--      "cancelled"; this says whether a person cancelled it, it lapsed uncollected
--      (no_show), a waitlist entry ran out (expired), or — from phase 2 on — the
--      booking was moved to another unit or shortened. The reliability score reads
--      it: a no-show costs a little, the others cost nothing.
--
--   2. More event kinds on fleet_asset_events, so the sweep and the later phases
--      can write an honest audit trail (no_show, extended, shortened,
--      moved_booking, notice_sent).
--
-- Nothing here changes RLS or grants: both tables keep their existing policies
-- (authenticated select, service-role writes).
--
-- Apply by hand in the Supabase SQL Editor, like the other migrations in this
-- directory. Safe to re-run.

alter table public.fleet_reservations
  add column if not exists closed_reason text;

alter table public.fleet_reservations
  drop constraint if exists fleet_reservations_closed_reason_check;

alter table public.fleet_reservations
  add constraint fleet_reservations_closed_reason_check
  check (closed_reason is null
         or closed_reason in ('returned', 'cancelled', 'no_show', 'expired', 'moved', 'shortened'));

-- Backfill the two reasons that follow from the status alone, so the score and
-- the UI see one shape of history rather than "old rows have no reason".
update public.fleet_reservations
   set closed_reason = 'returned'
 where status = 'returned' and closed_reason is null;

update public.fleet_reservations
   set closed_reason = 'cancelled'
 where status = 'cancelled' and closed_reason is null;

alter table public.fleet_asset_events
  drop constraint if exists fleet_asset_events_kind_check;

alter table public.fleet_asset_events
  add constraint fleet_asset_events_kind_check
  check (kind in ('created', 'checked_out', 'checked_in', 'moved', 'location_confirmed',
                  'status_changed', 'reserved', 'cancelled', 'note',
                  'no_show', 'expired', 'extended', 'shortened', 'moved_booking', 'notice_sent'));
