-- Fleet tables: service-role only.
--
-- Until now any signed-in role holder could SELECT the fleet tables directly
-- with their own token (policies `*_select_all`, guarded only by
-- public.has_app_role() since 2026-10-02-require-role.sql). Since #290 the
-- roles without Fleet (US pilots, HR) are refused by /api/fleet, but they
-- could still read every booking straight from the REST API.
--
-- Nothing in the app reads these tables with a user's token: every read and
-- write goes through /api/fleet (and the crons) on the service-role client,
-- which bypasses RLS. So instead of re-encoding "which roles have Fleet" in
-- SQL, the user-facing grants go, the same as fleet_booking_requests,
-- fleet_notice_sends and fleet_holder_aliases already are. RLS stays enabled
-- with no policies, so a grant restored by mistake still returns nothing.
--
-- Not touched: the `fleet:board` Realtime topic. Its pings carry no data (the
-- board route decides what each viewer sees), so a role holder hearing that
-- "something changed" learns nothing.
--
-- Safe to re-run.

begin;

-- All nine fleet tables, so this file alone states the rule. The last four
-- were already closed; repeating it is a no-op.
revoke all on table public.fleet_assets from public, anon, authenticated;
revoke all on table public.fleet_reservations from public, anon, authenticated;
revoke all on table public.fleet_asset_events from public, anon, authenticated;
revoke all on table public.fleet_settings from public, anon, authenticated;
revoke all on table public.fleet_holder_directory from public, anon, authenticated;
revoke all on table public.fleet_holder_aliases from public, anon, authenticated;
revoke all on table public.fleet_reminder_sends from public, anon, authenticated;
revoke all on table public.fleet_booking_requests from public, anon, authenticated;
revoke all on table public.fleet_notice_sends from public, anon, authenticated;

drop policy if exists "fleet_assets_select_all" on public.fleet_assets;
drop policy if exists "fleet_reservations_select_all" on public.fleet_reservations;
drop policy if exists "fleet_asset_events_select_all" on public.fleet_asset_events;
drop policy if exists "fleet_settings_select_all" on public.fleet_settings;
drop policy if exists "fleet_holder_directory_select_all" on public.fleet_holder_directory;

alter table public.fleet_assets enable row level security;
alter table public.fleet_reservations enable row level security;
alter table public.fleet_asset_events enable row level security;
alter table public.fleet_settings enable row level security;
alter table public.fleet_holder_directory enable row level security;
alter table public.fleet_holder_aliases enable row level security;
alter table public.fleet_reminder_sends enable row level security;
alter table public.fleet_booking_requests enable row level security;
alter table public.fleet_notice_sends enable row level security;

commit;

-- Verify (all three should return 0 rows):
--   select table_name, grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public' and table_name like 'fleet_%'
--      and grantee in ('anon', 'authenticated');
--   select tablename, policyname from pg_policies
--    where schemaname = 'public' and tablename like 'fleet_%';
--   select relname from pg_class
--    where relnamespace = 'public'::regnamespace and relname like 'fleet_%'
--      and relkind = 'r' and not relrowsecurity;
-- Then open Fleet in the app: the board still loads and booking still works.
