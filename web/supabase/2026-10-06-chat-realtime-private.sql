-- Team chat: private Realtime channel, and no XML attachments (audit run-5).
-- Apply by hand in the SQL editor. Safe to re-run.
--
-- ORDER:
--   1. Apply this file.
--   2. Deploy the code that joins `team-chat:global` with `private: true`
--      (lib/chat.ts). Without step 1 a private join is refused outright, and
--      the whole channel goes with it — live messages (postgres_changes) as
--      well as presence/typing — so the SQL must come first.
--   3. Only after the deploy: Supabase dashboard → Realtime → Settings: switch
--      OFF "Allow public access". Until then a client can still join the
--      public channel of the same name with only the anon key. Tabs still on
--      the old bundle lose live chat at this point until they reload.
--
-- 1. Presence and typing ran on a PUBLIC Realtime channel. Table RLS covers
--    postgres_changes only; broadcast and presence on a public channel need no
--    authorisation at all, so anyone holding the anon key (it ships in every
--    page) could join `team-chat:global`, watch every online employee's email
--    and user id, and send fake "is typing" events. A private channel is
--    authorised by RLS on realtime.messages: role holders only, the same rule
--    as the chat tables (public.has_app_role(), 2026-10-02-require-role.sql).
--
-- 2. application/xml and text/xml were on the chat-attachments allowlist on
--    the belief that nosniff renders them as text. It does not: a browser
--    renders an XML document, and an XHTML-namespaced one runs <script>, on
--    the Supabase origin when the signed link is opened. The code now signs
--    every link with `download` (Content-Disposition: attachment); this also
--    takes the types off the list. Existing XML objects stay readable as
--    downloads.

begin;

-- 1. Realtime authorisation for the team chat channel. (Supabase ships
-- realtime.messages with RLS already enabled and owned by the realtime admin
-- role, so this only adds policies.)
drop policy if exists team_chat_realtime_select on realtime.messages;
create policy team_chat_realtime_select
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() = 'team-chat:global'
    and realtime.messages.extension in ('presence', 'broadcast')
    and public.has_app_role()
  );

drop policy if exists team_chat_realtime_insert on realtime.messages;
create policy team_chat_realtime_insert
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.topic() = 'team-chat:global'
    and realtime.messages.extension in ('presence', 'broadcast')
    and public.has_app_role()
  );

-- 2. No XML on the attachment allowlist.
update storage.buckets
  set allowed_mime_types = array_remove(array_remove(allowed_mime_types, 'application/xml'), 'text/xml')
  where id = 'chat-attachments';

commit;

-- Verify:
--   select policyname, cmd from pg_policies where schemaname = 'realtime' and tablename = 'messages';
--   select allowed_mime_types from storage.buckets where id = 'chat-attachments';  -- no xml
