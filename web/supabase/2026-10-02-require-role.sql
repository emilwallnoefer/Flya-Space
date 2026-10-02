-- Security audit run-4, finding 3 (MEDIUM). Apply by hand in the SQL editor.
-- Safe before or after the accompanying code deploy.
--
-- An account with no role is "held": dashboard/page.tsx shows it the role gate
-- and nothing else. But that page was the only check. Every team-wide policy
-- below was `to authenticated using (true)`, so a held account — a new hire not
-- yet approved, or an employee whose role an admin removed — could still read
-- the whole team chat, its attachments and the fleet tables straight from the
-- database with its own token. The API routes now refuse held accounts
-- (lib/app-access.ts); this file closes the same door in the database.
--
-- The database cannot see ADMIN_EMAILS, so admins pass here the same way as
-- everyone else: by having a role. (Checked 2026-09-29: the one admin has one.)
-- An admin who ever loses their role keeps the API but loses direct table
-- reads, which is the safe direction.
--
-- The role comes from the access token (auth.jwt()), so a role change reaches
-- the database when the token is reissued. lib/supabase/middleware.ts forces
-- that on the next page load whenever the token's role and the real one differ.
--
-- Deliberately unchanged: per-user policies (time tracker, onboarding, the
-- update/delete-own policies on chat and votes, attachment delete-own) — a held
-- account owns nothing worth guarding there — and elios_scores, which held
-- accounts keep by decision (the game is on the role gate).
--
-- Safe to re-run.

begin;

-- True when the caller's token carries a role an admin assigned. Mirrors
-- normalizeUserRole() in src/lib/user-role.ts — keep the two lists in step.
create or replace function public.has_app_role()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') in ('sales', 'eu_pilot', 'us_pilot', 'hr', 'pilot'),
    false
  );
$$;

-- Policies run their helpers as the querying role, so authenticated needs
-- EXECUTE or every guarded query fails. See CLAUDE.md "Function grants".
revoke execute on function public.has_app_role() from public, anon;
grant execute on function public.has_app_role() to authenticated;

-- Team chat.
alter policy "chat_messages_select_authed" on public.chat_messages
  using (public.has_app_role());
alter policy "chat_messages_insert_own" on public.chat_messages
  with check (auth.uid() = sender_id and public.has_app_role());
alter policy "votes_select_authed" on public.chat_message_votes
  using (public.has_app_role());
alter policy "votes_insert_own" on public.chat_message_votes
  with check (auth.uid() = user_id and public.has_app_role());

-- Chat attachments.
alter policy "chat_attachments_select_authed" on storage.objects
  using (bucket_id = 'chat-attachments' and public.has_app_role());
alter policy "chat_attachments_insert_own" on storage.objects
  with check (
    bucket_id = 'chat-attachments'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.has_app_role()
  );

-- Fleet (all writes already go through the API on the service-role client).
alter policy "fleet_assets_select_all" on public.fleet_assets
  using (public.has_app_role());
alter policy "fleet_reservations_select_all" on public.fleet_reservations
  using (public.has_app_role());
alter policy "fleet_asset_events_select_all" on public.fleet_asset_events
  using (public.has_app_role());
alter policy "fleet_settings_select_all" on public.fleet_settings
  using (public.has_app_role());
alter policy "fleet_holder_directory_select_all" on public.fleet_holder_directory
  using (public.has_app_role());

-- Verification: fail the whole transaction if the helper is not callable by
-- authenticated (which would break chat for everyone) or is callable by anon.
do $$
begin
  if not has_function_privilege('authenticated', 'public.has_app_role()', 'EXECUTE') then
    raise exception 'authenticated cannot execute has_app_role(): every guarded query would fail';
  end if;
  if has_function_privilege('anon', 'public.has_app_role()', 'EXECUTE') then
    raise exception 'anon can execute has_app_role()';
  end if;
end;
$$;

commit;
