-- Field stats (burger menu → Field stats): charts computed from the
-- "Mission planning" tab of the planning spreadsheet. Apply by hand in the SQL
-- editor. Safe before or after the accompanying code deploy — until it exists
-- the panel reports "not configured".
--
-- Its own single-row table rather than columns on workspace_settings:
-- readWorkspaceSettings() selects its columns by name, so a column it expects
-- but the database lacks would fail that read and silently reset the mail and
-- reminder settings to their defaults.
--
--   token_user_id  — whose Google connection (public.gmail_tokens) reads the
--                    sheet. Set by an admin choosing "Use my Google connection";
--                    the Gmail connect flow already grants spreadsheets.readonly.
--   sales_regions  — { "<salesperson as written in 'Reporting to'>": "<region>" }.
--                    Each salesperson owns a region, so this is what turns the
--                    sheet's names into the regions chart.
--
-- Service-role only: read by /api/field-stats and written by
-- /api/admin/field-stats-settings (guardAdmin). No browser access.
--
-- Safe to re-run.

begin;

create table if not exists public.field_stats_settings (
  -- Single-row table: the primary key can only ever be true.
  id boolean primary key default true,
  token_user_id uuid references auth.users (id) on delete set null,
  sales_regions jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint field_stats_settings_single_row check (id),
  constraint field_stats_settings_regions_object check (jsonb_typeof(sales_regions) = 'object')
);

insert into public.field_stats_settings (id) values (true) on conflict (id) do nothing;

alter table public.field_stats_settings enable row level security;
alter table public.field_stats_settings force row level security;

revoke all on table public.field_stats_settings from public, anon, authenticated;
grant select, insert, update on table public.field_stats_settings to service_role;

commit;
