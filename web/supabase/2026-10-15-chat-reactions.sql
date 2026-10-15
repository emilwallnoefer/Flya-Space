-- Team chat: emoji reactions. Apply by hand in the SQL editor. Safe to re-run.
--
-- ORDER: either way. Until this is applied the client's first read answers
-- "relation does not exist", and reactions are switched off for that page load
-- (src/lib/chat.ts) — the chat itself keeps working; reactions appear once this
-- is in.
--
-- A reaction is its own row, never a change to the message, so reacting does
-- not raise a chat_messages INSERT/UPDATE: nobody's unread badge moves, no
-- "new message" sound plays, and the phone's /api/chat/unread count (which
-- reads chat_messages only) is unaffected.
--
-- One row per (message, person, emoji): a person can leave several different
-- emoji on one message, each once. The emoji are a fixed set (lib/chat-reactions.ts
-- CHAT_REACTIONS — keep the two lists the same) so the table holds no free text.

begin;

create table if not exists public.chat_message_reactions (
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

alter table public.chat_message_reactions
  drop constraint if exists chat_message_reactions_emoji_check;
alter table public.chat_message_reactions
  add constraint chat_message_reactions_emoji_check
  check (emoji in ('👍', '❤️', '😂', '🎉', '😮', '🙏'));

create index if not exists idx_chat_message_reactions_message
  on public.chat_message_reactions (message_id);

alter table public.chat_message_reactions enable row level security;
alter table public.chat_message_reactions force row level security;
-- DELETE events must carry the whole key so other tabs know which chip to drop.
alter table public.chat_message_reactions replica identity full;

-- Add and remove only: there is nothing on a reaction to update.
revoke all on table public.chat_message_reactions from anon;
revoke all on table public.chat_message_reactions from authenticated;
grant select, insert, delete on table public.chat_message_reactions to authenticated;

-- Role holders only, like every team-wide chat policy (2026-10-02-require-role.sql).
drop policy if exists "reactions_select_role" on public.chat_message_reactions;
create policy "reactions_select_role"
  on public.chat_message_reactions for select
  to authenticated
  using (public.has_app_role());

drop policy if exists "reactions_insert_own" on public.chat_message_reactions;
create policy "reactions_insert_own"
  on public.chat_message_reactions for insert
  to authenticated
  with check (auth.uid() = user_id and public.has_app_role());

drop policy if exists "reactions_delete_own" on public.chat_message_reactions;
create policy "reactions_delete_own"
  on public.chat_message_reactions for delete
  to authenticated
  using (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_message_reactions'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_message_reactions';
  end if;
end
$$;

commit;

-- Verify:
--   select policyname, cmd from pg_policies where tablename = 'chat_message_reactions';
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_message_reactions';
