-- Housekeeping: drop `fleet_assets.kind_key`.
-- Run after 2026-10-19-fleet-edge-cases-5.sql, once #265 is deployed (it was
-- the last code that read the column). Safe to re-run.
--
-- The column arrived with phase 4 (2026-10-19-fleet-edge-cases-4.sql) as an
-- admin-set slug naming interchangeable units, and was withdrawn the same day:
-- twins are now every unit of the same MODEL (`fleet_assets.model`, compared
-- with spelling folded), so there is nothing to set per unit and nothing reads
-- this column. Leaving it would only invite someone to fill it in again.

drop index if exists public.fleet_assets_kind_idx;

alter table public.fleet_assets
  drop constraint if exists fleet_assets_kind_key_shape;

alter table public.fleet_assets
  drop column if exists kind_key;
