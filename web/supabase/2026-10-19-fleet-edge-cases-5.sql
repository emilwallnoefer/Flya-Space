-- Fleet edge cases, phase 5b: siblings by type, and borrowing assigned material.
-- Plan: web/docs/fleet-edge-cases.md (section D, revised 2026-10-19).
-- Run after 2026-10-19-fleet-edge-cases-4.sql. Safe to re-run.
--
-- Two owner decisions, both from 2026-10-19:
--
--   1. "Interchangeable with" is no longer a slug admins maintain. Every unit of
--      the same TYPE (`fleet_assets.category`) stands in for every other, so a
--      clash offers every free unit of that type. `kind_key` is left in place,
--      unread, so this file can run before or after the code that stops reading
--      it; a later housekeeping migration drops the column.
--
--   2. Assigned material (pooled = false) can be REQUESTED. The request goes to
--      the person it is assigned to (admins, when that person has no account),
--      and nothing is booked until they approve. While pending, the booking is a
--      `waitlisted` row on the assigned unit — it blocks nobody and the
--      exclusion constraint ignores it — and this table carries the question.
--      Approval flips it to `reserved`; a decline cancels it.

-- The request table grows a second kind. The two reservation columns were
-- `not null` for extensions (two bookings: the one that wants to grow and the
-- one in its way); a borrow has only the pending booking, so the target is null.
alter table public.fleet_booking_requests
  alter column target_reservation_id drop not null;

alter table public.fleet_booking_requests
  add column if not exists asset_id uuid references public.fleet_assets (id) on delete cascade,
  add column if not exists requested_start_date date,
  -- The assignee's name as written on the unit, for the record and the notice
  -- when there is no account behind it.
  add column if not exists holder_label text;

alter table public.fleet_booking_requests
  drop constraint if exists fleet_booking_requests_kind_check;
alter table public.fleet_booking_requests
  add constraint fleet_booking_requests_kind_check check (kind in ('extension', 'borrow'));

alter table public.fleet_booking_requests
  drop constraint if exists fleet_booking_requests_resolution_check;
alter table public.fleet_booking_requests
  add constraint fleet_booking_requests_resolution_check
  check (resolution is null or resolution in ('shorten', 'cancel', 'move', 'approve'));

-- An extension names both bookings; a borrow names the asset and its dates.
alter table public.fleet_booking_requests
  drop constraint if exists fleet_booking_requests_shape;
alter table public.fleet_booking_requests
  add constraint fleet_booking_requests_shape check (
    (kind = 'extension' and target_reservation_id is not null)
    or (kind = 'borrow' and asset_id is not null and requested_start_date is not null)
  );

-- One open question per pending borrow booking.
create unique index if not exists fleet_booking_requests_one_pending_borrow
  on public.fleet_booking_requests (reservation_id)
  where kind = 'borrow' and status = 'pending';

-- Audit trail for the new conversation.
alter table public.fleet_asset_events
  drop constraint if exists fleet_asset_events_kind_check;

alter table public.fleet_asset_events
  add constraint fleet_asset_events_kind_check
  check (kind in ('created', 'checked_out', 'checked_in', 'moved', 'location_confirmed',
                  'status_changed', 'reserved', 'cancelled', 'note',
                  'no_show', 'expired', 'extended', 'shortened', 'moved_booking', 'notice_sent',
                  'extension_requested', 'extension_resolved',
                  'borrow_requested', 'borrow_resolved'));
