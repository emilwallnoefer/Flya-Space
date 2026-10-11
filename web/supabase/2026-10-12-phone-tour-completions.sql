-- "Somebody clicked through the phone walkthrough" — the once-only admin notice.
--
-- The desktop shows a one-time tour of the phone app (components/phone-tour.tsx).
-- When a person presses Done on its last step, the admins get one push on their
-- subscribed phones. This table is the claim that stops that going out twice
-- for the same person — a second Done
-- (the tour can be re-opened with ?tour=phone), a double-click, or two tabs.
--
-- Same claim-before-send shape as `role_assignment_notices`: the PRIMARY KEY on
-- `user_id` is the gate, the server INSERTs before it sends, and a lost insert
-- means somebody already told the admins.
--
-- Written only with the service-role key from the server; no grant is given
-- back to anon/authenticated, so the table is invisible to end users.

create table if not exists public.phone_tour_completions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  pushed integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_phone_tour_completions_created_at
  on public.phone_tour_completions (created_at desc);

alter table public.phone_tour_completions enable row level security;
alter table public.phone_tour_completions force row level security;

revoke all on table public.phone_tour_completions from anon, authenticated;
