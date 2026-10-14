-- Chat messages can be edited for 10 minutes after they were sent.
-- Apply by hand in the SQL editor. Safe before or after the deploy that hides
-- the Edit button (src/lib/chat-edit-window.ts), and safe to re-run.
--
-- Edits go straight from the browser to chat_messages (the column grant on
-- body, edited_at), so hiding the button alone would not stop them. This
-- extends the edit trigger from 2026-10-02-chat-request-integrity.sql: a
-- user's own request (an `authenticated` or `anon` token) that changes the
-- body more than 12 minutes after created_at is refused. The 2 minutes over
-- the UI's 10 are grace for an edit opened just before the deadline.
-- created_at is stamped by the insert trigger, so it cannot be moved forward
-- to reopen the window. The service role and this editor are not affected.

begin;

create or replace function public.chat_messages_stamp_edit()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  caller text := coalesce(auth.jwt() ->> 'role', '');
begin
  if new.body is distinct from old.body then
    if caller in ('authenticated', 'anon')
       and now() > old.created_at + interval '12 minutes' then
      raise exception 'Messages can only be edited within 10 minutes of sending.'
        using errcode = '42501';
    end if;
    -- Any change to the text is an edit, and shows as one.
    new.edited_at := now();
  else
    -- Nobody gets to clear or backdate the marker on its own.
    new.edited_at := old.edited_at;
  end if;
  return new;
end;
$$;

revoke execute on function public.chat_messages_stamp_edit() from public, anon, authenticated;

commit;
