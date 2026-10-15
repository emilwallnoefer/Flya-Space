-- Team chat reactions: 🎉 out, 🔥 in. Apply by hand in the SQL editor. Safe to re-run.
--
-- ORDER: apply this BEFORE deploying the code that offers 🔥, or a 🔥 tap
-- fails the check until it is in. (Tabs still on the old bundle can't add 🎉
-- once this is applied; they get a "Reaction failed" until they reload.)
--
-- Existing 🎉 reactions are removed: the new check would refuse them, and the
-- client no longer renders an emoji outside its set anyway. Keep this list the
-- same as CHAT_REACTIONS in src/lib/chat-reactions.ts.

begin;

delete from public.chat_message_reactions where emoji = '🎉';

alter table public.chat_message_reactions
  drop constraint if exists chat_message_reactions_emoji_check;
alter table public.chat_message_reactions
  add constraint chat_message_reactions_emoji_check
  check (emoji in ('👍', '❤️', '😂', '🔥', '😮', '🙏'));

commit;

-- Verify:
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'chat_message_reactions_emoji_check';
