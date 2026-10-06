-- Security audit run-5 hardening. Nothing here closes an open hole; both items
-- tighten layers whose neighbours already hold. Apply by hand in the SQL editor.
-- Safe to re-run.
--
-- 1. hook_restrict_signup_domain had no pinned search_path (the Supabase
--    linter flags it). It calls only pg_catalog built-ins, which stay
--    resolvable with an empty search_path.
--
-- 2. anon still held table privileges on five time-tracker tables, so a
--    request with only the anon key got `200 []` there instead of a refusal
--    (the auth.uid() RLS policies return no rows, so nothing was readable).
--    This takes the grants away so the database refuses at the privilege
--    check, as it does for every other table.
--
-- 3. create_time_tracker_snapshot kept Supabase's by-name EXECUTE grant to
--    anon (its migration revoked only PUBLIC). It is SECURITY INVOKER and
--    refuses a null auth.uid() itself, so anon got "Not authenticated"; now
--    the grant goes, and scripts/rls-smoke.mjs check 7 probes it.

begin;

alter function public.hook_restrict_signup_domain(jsonb) set search_path = '';

revoke all on table
  public.time_day_logs,
  public.time_day_breaks,
  public.time_comp_adjustments,
  public.time_tracker_audit_log,
  public.time_tracker_snapshots
  from anon;

revoke execute on function public.create_time_tracker_snapshot(uuid, text) from anon;

commit;

-- Verify (expect zero rows):
--   select table_name, privilege_type from information_schema.role_table_grants
--   where grantee = 'anon' and table_schema = 'public'
--     and table_name in ('time_day_logs','time_day_breaks','time_comp_adjustments',
--                        'time_tracker_audit_log','time_tracker_snapshots');
