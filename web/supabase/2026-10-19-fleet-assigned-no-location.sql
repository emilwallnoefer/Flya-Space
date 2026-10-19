-- Fleet: an assigned unit carries no location.
--
-- Run after `2026-10-19-fleet-drop-home-location.sql`.
--
-- Material assigned to one person travels with them and nobody logs where it
-- goes, so a location on it is wrong by the next morning. The app never shows
-- one for an assigned unit; from this change on it never writes one either
-- (`assign`, `update_asset` leaving the pool, a borrower's `check_in`). This
-- clears what the EMEA import and the old handlers left behind. Owner
-- decision, 2026-10-19.
--
-- Safe to re-run.

update public.fleet_assets
   set current_location = null,
       location_confirmed_at = null
 where not pooled
   and current_location is not null;
