-- Fleet: there is no per-unit home location — every pooled unit lives at
-- "Pilots HQ Lausanne" between jobs.
--
-- Run after `2026-10-19-fleet-edge-cases-5.sql`. Deploy the app first: the
-- code on main no longer reads or writes `home_location`, so dropping the
-- column is safe once that build is live (a build that still selects it
-- would fail on every fleet read).
--
-- `home_location` was "Pilots HQ Lausanne" on every row that had one, so the
-- field only ever restated the constant now named FLEET_HOME_LOCATION in
-- `lib/fleet-rules.ts`; check-in, return-to-pool and a new pooled unit land
-- there in code. Owner decision, 2026-10-19.
--
-- "Move all materials to that location": every pooled unit's current location
-- becomes the HQ. Assigned units (`pooled = false`) travel with their person
-- and carry no location in the app, so they are left alone — see the Material
-- register in `components/fleet/manage-material.tsx`.
--
-- Safe to re-run: the update is idempotent and the drop is `if exists`.

update public.fleet_assets
   set current_location = 'Pilots HQ Lausanne',
       location_confirmed_at = now()
 where pooled
   and current_location is distinct from 'Pilots HQ Lausanne';

alter table public.fleet_assets drop column if exists home_location;
