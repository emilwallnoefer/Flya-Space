-- Security audit run-4, finding 2 (HIGH). Already APPLIED to production on
-- 2026-09-29 and verified live (see the bottom of this header); this file
-- records what is in the database.
--
-- The @flyability.com rule used to live only in app/auth/callback/route.ts, and
-- that route runs AFTER Supabase has created the account and issued a session.
-- With sign-up open (email + Google providers), anyone could get a session that
-- never touched the callback — e.g. POST /auth/v1/signup, confirm their own
-- inbox, sign in with a password — and that session carries every
-- `to authenticated` grant: the whole team chat and its attachments, the fleet
-- directory, the session-only API routes. A domain check in our own route can
-- only refuse the redirect, not the account.
--
-- This function is a Supabase Auth "Before User Created" hook: Auth calls it
-- before inserting into auth.users, for every provider, and an `error` in the
-- returned object refuses the sign-up outright. Existing accounts are untouched
-- — the hook only runs on creation.
--
-- The function alone does nothing. It must be switched on in the dashboard:
--   Authentication → Hooks → Before User Created → Postgres →
--   schema `public`, function `hook_restrict_signup_domain` → Create hook
-- (done 2026-09-29; the dashboard also re-runs the grants below when it saves).
--
-- Known consequence: new `@mail-automator.test` accounts for scripts/rls-smoke.mjs
-- can no longer be created (none existed when this shipped). To create one,
-- disable the hook for the duration, then re-enable it.
--
-- Verified live 2026-09-29: an anon-key POST /auth/v1/signup for
-- audit-test@example.com returned 403 "Sign-up is limited to @flyability.com
-- accounts." and created no user.
--
-- Safe to re-run.

begin;

create or replace function public.hook_restrict_signup_domain(event jsonb)
returns jsonb
language plpgsql
as $$
declare
  signup_email text := lower(coalesce(event->'user'->>'email', ''));
begin
  if signup_email like '%@flyability.com' then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Sign-up is limited to @flyability.com accounts.'
    )
  );
end;
$$;

-- Only Supabase Auth calls it. Following the rule in CLAUDE.md, revoke by name.
revoke execute on function public.hook_restrict_signup_domain(jsonb) from public, anon, authenticated;
grant execute on function public.hook_restrict_signup_domain(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;

commit;
