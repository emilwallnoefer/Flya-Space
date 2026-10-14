-- Team chat: replies. Apply by hand in the SQL editor. Safe to re-run.
--
-- ORDER: either way. The client selects `reply_to` only until the first
-- "undefined column" answer, then falls back to the old columns and hides
-- the Reply action for that page load (src/lib/chat.ts), so the chat keeps
-- working before this is applied; replies simply appear once it is.
--
-- A reply is a normal message that points at the one it answers. Deleting the
-- original keeps the reply and drops the pointer (the quote then reads
-- "Replying to an earlier message"). `authenticated` holds a table-wide INSERT grant,
-- so a reply can be sent; the column-level UPDATE grant from
-- 2026-04-19-team-chat-marks-and-votes.sql covers only (body, edited_at), so
-- what a message replies to cannot be changed afterwards.

begin;

alter table public.chat_messages
  add column if not exists reply_to uuid references public.chat_messages(id) on delete set null;

create index if not exists chat_messages_reply_to_idx
  on public.chat_messages (reply_to)
  where reply_to is not null;

commit;

-- Verify:
--   select column_name from information_schema.columns
--     where table_schema = 'public' and table_name = 'chat_messages' and column_name = 'reply_to';
