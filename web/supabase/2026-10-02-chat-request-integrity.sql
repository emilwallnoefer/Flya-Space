-- Security audit run-4, finding 8 (LOW). Apply by hand in the SQL editor.
-- Safe before or after the accompanying deploy: no app code depends on it.
--
-- `authenticated` holds an INSERT grant on chat_messages and the only check is
-- `auth.uid() = sender_id`. A user writing to the table directly (with the
-- browser's own token, bypassing the app) could therefore:
--   * create a `certificate_request` row with made-up details and no admin
--     mail — app/api/chat/certificate-request is meant to be the ONLY writer;
--   * create a row of the retired `change_request` kind, which the app says no
--     new row may have (src/lib/chat.ts);
--   * backdate a message with any `created_at`;
--   * and, through the column grant on (body, edited_at), rewrite a message
--     while leaving or setting `edited_at` null, so "(edited)" never shows —
--     e.g. changing a certificate request after the admins were mailed.
-- sender_email was already stamped from the token (2026-07-03 hardening), so
-- the displayed author was always truthful.
--
-- Editing your own messages, certificate requests included, keeps working —
-- the chat offers it. It just can no longer be silent.
--
-- "A user's own request" below means a request carrying an `authenticated` or
-- `anon` token. The service role (the certificate-request route) and direct
-- database sessions (this editor, which carries no token) are not affected.
--
-- Safe to re-run.

begin;

create or replace function public.chat_messages_guard_insert()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  caller text := coalesce(auth.jwt() ->> 'role', '');
begin
  if caller in ('authenticated', 'anon') then
    if new.kind in ('certificate_request', 'change_request') then
      raise exception 'chat_messages: % rows are created by the app, not directly', new.kind
        using errcode = '42501';
    end if;
    new.created_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.chat_messages_stamp_edit()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if new.body is distinct from old.body then
    -- Any change to the text is an edit, and shows as one.
    new.edited_at := now();
  else
    -- Nobody gets to clear or backdate the marker on its own.
    new.edited_at := old.edited_at;
  end if;
  return new;
end;
$$;

-- Trigger functions are not callable through the API; revoke regardless.
revoke execute on function public.chat_messages_guard_insert() from public, anon, authenticated;
revoke execute on function public.chat_messages_stamp_edit() from public, anon, authenticated;

drop trigger if exists chat_messages_guard_insert on public.chat_messages;
create trigger chat_messages_guard_insert
  before insert on public.chat_messages
  for each row execute function public.chat_messages_guard_insert();

drop trigger if exists chat_messages_stamp_edit on public.chat_messages;
create trigger chat_messages_stamp_edit
  before update on public.chat_messages
  for each row execute function public.chat_messages_stamp_edit();

commit;
