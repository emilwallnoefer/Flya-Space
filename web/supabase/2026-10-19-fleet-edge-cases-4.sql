-- Fleet edge cases, phase 4: interchangeable units.
-- Plan: web/docs/fleet-edge-cases.md (P4). Run after 2026-10-19-fleet-edge-cases-3.sql.
--
-- `kind_key` says which units can stand in for each other ("elios-3",
-- "lidar-rev-7", "ut-payload"). It is set by admins in Fleet → Manage, one
-- unit at a time, from the keys already in use — never guessed from the
-- free-text `model`, which spells the same thing three ways. A unit with no
-- kind is never offered as an alternative; nothing else changes for it.
--
-- The app reads it on the board, in the reserve refusal ("SVA-330 is free for
-- those days"), in the notices, and in `move_booking`, which moves a booking
-- to a free sibling at the owner's tap.
--
-- Safe to re-run.

alter table public.fleet_assets
  add column if not exists kind_key text;

alter table public.fleet_assets
  drop constraint if exists fleet_assets_kind_key_shape;

-- Lower-case slug, so "Elios 3" and "elios-3" cannot drift into two kinds.
alter table public.fleet_assets
  add constraint fleet_assets_kind_key_shape
  check (kind_key is null or kind_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

create index if not exists fleet_assets_kind_idx
  on public.fleet_assets (kind_key)
  where kind_key is not null and active;
