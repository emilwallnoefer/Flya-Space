-- Security audit run-4, finding 1 (CRITICAL). Apply by hand like the other flat
-- migrations. No code change depends on it, so it can go in before or after a
-- deploy — apply it as soon as possible.
--
-- Every admin RPC in this schema pairs its grant with
-- `revoke all on function ... from public`. That was believed to lock them to
-- service_role, and on vanilla Postgres it would. Supabase is different: its
-- default privileges grant EXECUTE on every new function in `public` to `anon`,
-- `authenticated` and `service_role` BY NAME. Revoking from PUBLIC does not touch
-- those named grants, and CREATE OR REPLACE preserves the ACL, so all of the
-- functions below have been executable with nothing but the public anon key —
-- the one shipped in every page's JavaScript. Confirmed live on 2026-09-29:
-- `POST /rest/v1/rpc/mail_recipient_search` answered 200 to an anon caller.
--
-- They are SECURITY DEFINER, so they read with RLS bypassed:
--
--   tt_admin_overview, tt_workspace_summary
--       every user id with weekly hours, missing days and overtime balance
--   mail_recipient_recent, mail_recipient_week, mail_recipient_search,
--   mail_overview_stats, mail_click_timeline, mail_link_leaderboard
--       external recipients' names, companies, sends and click history
--   tt_refresh_overtime_bank_stats
--       its caller check only runs when auth.uid() is not null, and for anon
--       it IS null. SECURITY.md records a live check on 2026-07-26 in which
--       anon was already denied here, so this is most likely a no-op — it is
--       included because a revoke costs nothing, and if that grant ever came
--       back anon could read any user's balance and rewrite their stats row.
--   tt_user_week_v1
--       scoped to auth.uid(), so anon only ever got an empty week; revoked
--       anyway, since no anonymous caller has any business calling it.
--
-- tt_resolve_audit_user_id is not listed: run-3 revoked it from all three roles,
-- which is the pattern this file applies everywhere else. Trigger functions
-- are not callable through PostgREST and are left alone.
--
-- Who still calls what afterwards (checked against every `.rpc(` in src/):
--   * the eight admin/mail functions — only through the service-role client,
--     behind guardAdmin()/guardTimeViewer(). service_role keeps its grant.
--   * tt_refresh_overtime_bank_stats and tt_user_week_v1 — through the signed-in
--     user's own client. `authenticated` keeps its grant; only `anon` loses it.
--
-- Future functions: the `alter default privileges` below stops `postgres` from
-- handing EXECUTE to anon/authenticated/PUBLIC on functions it creates from now
-- on. Every RPC must therefore grant what it needs explicitly — which every
-- migration here already does. That includes helper functions called from an
-- RLS policy: a policy runs the function as the querying role, so a helper
-- such as a role check needs `grant execute ... to authenticated`, or every
-- query the policy guards will fail with "permission denied for function".
--
-- To see the live ACL before/after:
--
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE')          as anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed,
--          has_function_privilege('service_role', p.oid, 'EXECUTE')  as service
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prosecdef
--   order by 1;
--
-- Safe to re-run. The block at the end raises if anything is still exposed, so
-- a successful run is itself the verification.

begin;

-- Admin-only: service_role is the sole caller.
revoke execute on function public.tt_admin_overview(date)                              from public, anon, authenticated;
revoke execute on function public.tt_workspace_summary(date, date)                     from public, anon, authenticated;
revoke execute on function public.mail_recipient_recent(integer, integer)              from public, anon, authenticated;
revoke execute on function public.mail_recipient_week(timestamptz, timestamptz)        from public, anon, authenticated;
revoke execute on function public.mail_recipient_search(text, integer)                 from public, anon, authenticated;
revoke execute on function public.mail_overview_stats(timestamptz, integer)            from public, anon, authenticated;
revoke execute on function public.mail_click_timeline(text, timestamptz)               from public, anon, authenticated;
revoke execute on function public.mail_link_leaderboard(integer)                       from public, anon, authenticated;

grant execute on function public.tt_admin_overview(date)                               to service_role;
grant execute on function public.tt_workspace_summary(date, date)                      to service_role;
grant execute on function public.mail_recipient_recent(integer, integer)               to service_role;
grant execute on function public.mail_recipient_week(timestamptz, timestamptz)         to service_role;
grant execute on function public.mail_recipient_search(text, integer)                  to service_role;
grant execute on function public.mail_overview_stats(timestamptz, integer)             to service_role;
grant execute on function public.mail_click_timeline(text, timestamptz)                to service_role;
grant execute on function public.mail_link_leaderboard(integer)                        to service_role;

-- Signed-in users call these for their OWN data: keep authenticated, drop anon.
revoke execute on function public.tt_refresh_overtime_bank_stats(uuid, date)           from public, anon;
revoke execute on function public.tt_user_week_v1(date)                                from public, anon;
grant execute on function public.tt_refresh_overtime_bank_stats(uuid, date)            to authenticated;
grant execute on function public.tt_user_week_v1(date)                                 to authenticated;

-- Stop the next function from being born exposed. Two statements, because
-- they undo two different defaults: the schema-scoped one removes Supabase's
-- named grants, and only the GLOBAL one (no `in schema`) can remove Postgres's
-- built-in PUBLIC EXECUTE — a schema-scoped revoke cannot subtract from it, so
-- anon would still inherit EXECUTE through PUBLIC.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres
  revoke execute on functions from public;

-- Verification: fail the whole transaction if anon can still run ANY
-- SECURITY DEFINER function in public, or authenticated can run an admin one.
do $$
declare
  leaked text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into leaked
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if leaked is not null then
    raise exception 'anon can still execute SECURITY DEFINER functions: %', leaked;
  end if;

  select string_agg(p.proname, ', ' order by p.proname) into leaked
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'tt_admin_overview', 'tt_workspace_summary', 'mail_recipient_recent',
      'mail_recipient_week', 'mail_recipient_search', 'mail_overview_stats',
      'mail_click_timeline', 'mail_link_leaderboard'
    )
    and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if leaked is not null then
    raise exception 'authenticated can still execute admin functions: %', leaked;
  end if;
end;
$$;

commit;
