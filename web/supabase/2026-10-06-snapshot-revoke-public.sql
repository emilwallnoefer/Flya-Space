-- Follow-up to 2026-10-06-audit-run5-hardening.sql. Apply by hand; safe to re-run.
--
-- After that migration anon could still call create_time_tracker_snapshot
-- (it answered "Not authenticated" from its own check, so nothing leaked).
-- The revoke from anon was not enough because EXECUTE was still held by
-- PUBLIC: the `revoke all ... from public` in time-tracker-durability.sql had
-- evidently never reached production, and every role inherits from PUBLIC.
-- Name all three roles, then grant back only what the app needs.

begin;

revoke execute on function public.create_time_tracker_snapshot(uuid, text) from public, anon;
grant execute on function public.create_time_tracker_snapshot(uuid, text) to authenticated;

commit;

-- Verify (expect only authenticated, plus postgres/service_role):
--   select grantee, privilege_type from information_schema.routine_privileges
--   where routine_schema = 'public' and routine_name = 'create_time_tracker_snapshot';
