-- Fleet edge cases, phase 2: extend / shorten a booking, and extension requests.
-- Plan: web/docs/fleet-edge-cases.md (P2). Run after 2026-10-19-fleet-edge-cases-1.sql.
--
-- When someone needs material longer than booked and the extra days collide
-- with the NEXT booking, nothing moves on its own: the holder files a request,
-- and the next booker answers it (give up the leading days, cancel their
-- booking, or decline). The extension applies only once every colliding
-- booking has answered yes. This table is that conversation.
--
-- Service-role only: the API decides who may see or answer a request (the
-- recipient, or an admin when the target booking has no account behind it), and
-- the board hands each viewer only their own. No grants for `authenticated`.
--
-- Safe to re-run.

create table if not exists public.fleet_booking_requests (
  id uuid primary key default gen_random_uuid(),
  -- Only 'extension' today; the column exists so a later kind needs no migration.
  kind text not null default 'extension',
  -- The booking that wants to grow.
  reservation_id uuid not null references public.fleet_reservations (id) on delete cascade,
  -- The booking it would grow into.
  target_reservation_id uuid not null references public.fleet_reservations (id) on delete cascade,
  requested_end_date date not null,
  requester_id uuid references auth.users (id) on delete set null,
  -- Null when the target booking is filed under a name with no account: then
  -- only an admin can answer.
  recipient_id uuid references auth.users (id) on delete set null,
  -- 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled'
  status text not null default 'pending',
  -- How an accepted request was honoured: 'shorten' (target starts later),
  -- 'cancel' (target cancelled), 'move' (target moved to another unit; phase 4).
  resolution text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  constraint fleet_booking_requests_kind_check check (kind in ('extension')),
  constraint fleet_booking_requests_status_check
    check (status in ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  constraint fleet_booking_requests_resolution_check
    check (resolution is null or resolution in ('shorten', 'cancel', 'move')),
  constraint fleet_booking_requests_distinct check (reservation_id <> target_reservation_id)
);

-- One open question per pair of bookings.
create unique index if not exists fleet_booking_requests_one_pending
  on public.fleet_booking_requests (reservation_id, target_reservation_id)
  where status = 'pending';

create index if not exists fleet_booking_requests_recipient_idx
  on public.fleet_booking_requests (recipient_id, status);
create index if not exists fleet_booking_requests_requester_idx
  on public.fleet_booking_requests (requester_id, status);

alter table public.fleet_booking_requests enable row level security;
revoke all on table public.fleet_booking_requests from public, anon, authenticated;
grant all on table public.fleet_booking_requests to service_role;

-- Audit trail for the conversation.
alter table public.fleet_asset_events
  drop constraint if exists fleet_asset_events_kind_check;

alter table public.fleet_asset_events
  add constraint fleet_asset_events_kind_check
  check (kind in ('created', 'checked_out', 'checked_in', 'moved', 'location_confirmed',
                  'status_changed', 'reserved', 'cancelled', 'note',
                  'no_show', 'expired', 'extended', 'shortened', 'moved_booking', 'notice_sent',
                  'extension_requested', 'extension_resolved'));
